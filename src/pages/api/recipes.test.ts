import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

vi.mock("astro:env/server", () => ({
  OPENROUTER_API_KEY: "test-api-key",
  OPENROUTER_MODEL: "test-model",
}));

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/services/recipe-extraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/recipe-extraction")>();
  return { ...actual, extractRecipeFromPhoto: vi.fn() };
});

const { POST } = await import("./recipes");
const { createClient } = await import("@/lib/supabase");
const { extractRecipeFromPhoto } = await import("@/lib/services/recipe-extraction");

interface MockSupabaseConfig {
  attemptsCount?: { count: number; error?: unknown };
  recipeInsert?: { data: { id: string; name: string; type: string } | null; error?: unknown };
  ingredientsInsertError?: unknown;
  storageUploadError?: unknown;
}

function mockSupabaseClient(config: MockSupabaseConfig = {}) {
  const extractionAttemptsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue(config.attemptsCount ?? { count: 0, error: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
  };

  const recipesChain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi
      .fn()
      .mockResolvedValue(config.recipeInsert ?? { data: { id: "recipe-1", name: "Zupa", type: "soup" }, error: null }),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: null }),
  };

  const ingredientsChain = {
    insert: vi.fn().mockResolvedValue({ error: config.ingredientsInsertError ?? null }),
  };

  const from = vi.fn((table: string) => {
    if (table === "extraction_attempts") return extractionAttemptsChain;
    if (table === "recipes") return recipesChain;
    if (table === "recipe_ingredients") return ingredientsChain;
    throw new Error(`Unexpected table: ${table}`);
  });

  const upload = vi.fn().mockResolvedValue({ error: config.storageUploadError ?? null });
  const storage = { from: vi.fn().mockReturnValue({ upload }) };

  return { from, storage, extractionAttemptsChain, recipesChain, ingredientsChain, upload };
}

function makeContext(options: { user?: { id: string } | null; formData?: FormData }): APIContext {
  const formData = options.formData ?? new FormData();
  return {
    locals: { user: options.user === undefined ? { id: "user-1" } : options.user },
    request: { formData: () => Promise.resolve(formData), headers: new Headers() } as unknown as Request,
    cookies: {} as APIContext["cookies"],
  } as unknown as APIContext;
}

function photoFormData(file: File): FormData {
  const formData = new FormData();
  formData.set("photo", file);
  return formData;
}

const samplePhoto = () => new File(["data"], "photo.jpg", { type: "image/jpeg" });

describe("POST /api/recipes", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(extractRecipeFromPhoto).mockReset();
  });

  it("returns 401 for an unauthenticated request", async () => {
    const response = await POST(makeContext({ user: null }));

    expect(response.status).toBe(401);
  });

  it("returns 400 for a wrong-type file", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient() as never);
    const file = new File(["data"], "photo.gif", { type: "image/gif" });

    const response = await POST(makeContext({ formData: photoFormData(file) }));

    expect(response.status).toBe(400);
  });

  it("returns 400 for an oversized file", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient() as never);
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([oversized], "photo.jpg", { type: "image/jpeg" });

    const response = await POST(makeContext({ formData: photoFormData(file) }));

    expect(response.status).toBe(400);
  });

  it("returns 429 when the daily attempt cap is reached", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient({ attemptsCount: { count: 10 } }) as never);

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));

    expect(response.status).toBe(429);
  });

  it("persists recipe, ingredients, photo, and a success attempt log on a successful extraction", async () => {
    const client = mockSupabaseClient({ recipeInsert: { data: { id: "recipe-1", name: "Zupa", type: "soup" } } });
    vi.mocked(createClient).mockReturnValue(client as never);
    vi.mocked(extractRecipeFromPhoto).mockResolvedValue({
      success: true,
      name: "Zupa",
      type: "soup",
      ingredients: ["marchew", "cebula"],
      raw: {},
    });

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));
    const body = (await response.json()) as { success: boolean; recipe: { id: string }; typeUnconfirmed: boolean };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      recipe: { id: "recipe-1", name: "Zupa", type: "soup", ingredients: ["marchew", "cebula"] },
      typeUnconfirmed: false,
    });
    expect(client.upload).toHaveBeenCalledOnce();
    expect(client.recipesChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", name: "Zupa", type: "soup" }),
    );
    expect(client.ingredientsChain.insert).toHaveBeenCalledWith([
      { recipe_id: "recipe-1", name: "marchew", position: 0 },
      { recipe_id: "recipe-1", name: "cebula", position: 1 },
    ]);
    expect(client.extractionAttemptsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, recipe_id: "recipe-1" }),
    );
  });

  it("falls back to 'other' and flags typeUnconfirmed when the model didn't assign a type", async () => {
    const client = mockSupabaseClient({ recipeInsert: { data: { id: "recipe-2", name: "Coś", type: "other" } } });
    vi.mocked(createClient).mockReturnValue(client as never);
    vi.mocked(extractRecipeFromPhoto).mockResolvedValue({
      success: true,
      name: "Coś",
      type: null,
      ingredients: ["składnik"],
      raw: {},
    });

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));
    const body = (await response.json()) as { typeUnconfirmed: boolean };

    expect(body.typeUnconfirmed).toBe(true);
    expect(client.recipesChain.insert).toHaveBeenCalledWith(expect.objectContaining({ type: "other" }));
  });

  it("logs a failed attempt and has no recipe/ingredient/storage side effects on a classified extraction failure", async () => {
    const client = mockSupabaseClient();
    vi.mocked(createClient).mockReturnValue(client as never);
    vi.mocked(extractRecipeFromPhoto).mockResolvedValue({ success: false, reason: "not_a_recipe", raw: {} });

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));
    const body = (await response.json()) as { success: boolean; reason: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: false, reason: "not_a_recipe" });
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.recipesChain.insert).not.toHaveBeenCalled();
    expect(client.ingredientsChain.insert).not.toHaveBeenCalled();
    expect(client.extractionAttemptsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, failure_reason: "not_a_recipe" }),
    );
  });

  it("compensates by deleting the recipe row when the ingredients insert fails", async () => {
    const client = mockSupabaseClient({
      recipeInsert: { data: { id: "recipe-3", name: "Zupa", type: "soup" } },
      ingredientsInsertError: { message: "insert failed" },
    });
    vi.mocked(createClient).mockReturnValue(client as never);
    vi.mocked(extractRecipeFromPhoto).mockResolvedValue({
      success: true,
      name: "Zupa",
      type: "soup",
      ingredients: ["marchew"],
      raw: {},
    });

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));

    expect(response.status).toBe(500);
    expect(client.recipesChain.delete).toHaveBeenCalledOnce();
    expect(client.recipesChain.eq).toHaveBeenCalledWith("id", "recipe-3");
  });
});
