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

vi.mock("@/lib/services/recipe-query", () => ({
  listRecipes: vi.fn(),
  RECIPE_PHOTOS_BUCKET: "recipe-photos",
  SIGNED_URL_TTL_SECONDS: 3600,
}));

const { GET, POST } = await import("./recipes");
const { createClient } = await import("@/lib/supabase");
const { extractRecipeFromPhoto } = await import("@/lib/services/recipe-extraction");
const { listRecipes } = await import("@/lib/services/recipe-query");

interface MockSupabaseConfig {
  reserveResult?: { data: boolean | null; error?: unknown };
  recipeInsert?: {
    data: { id: string; name: string; type: string; instructions?: string | null } | null;
    error?: unknown;
  };
  ingredientsInsertError?: unknown;
  storageUploadError?: unknown;
  signedPhotoUrl?: string | null;
}

function mockSupabaseClient(config: MockSupabaseConfig = {}) {
  const extractionAttemptsChain = {
    insert: vi.fn().mockResolvedValue({ error: null }),
  };

  const rpc = vi.fn().mockResolvedValue(config.reserveResult ?? { data: true, error: null });

  const recipesChain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(
      config.recipeInsert ?? {
        data: { id: "recipe-1", name: "Zupa", type: "soup", instructions: null },
        error: null,
      },
    ),
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
  const remove = vi.fn().mockResolvedValue({ error: null });
  const createSignedUrl = vi.fn().mockResolvedValue({
    data:
      config.signedPhotoUrl === undefined
        ? { signedUrl: "https://signed.example/photo.jpg" }
        : config.signedPhotoUrl === null
          ? null
          : { signedUrl: config.signedPhotoUrl },
    error: null,
  });
  const storage = { from: vi.fn().mockReturnValue({ upload, remove, createSignedUrl }) };

  return {
    from,
    rpc,
    storage,
    extractionAttemptsChain,
    recipesChain,
    ingredientsChain,
    upload,
    remove,
    createSignedUrl,
  };
}

function makeContext(options: {
  user?: { id: string } | null;
  formData?: FormData;
  searchParams?: Record<string, string>;
}): APIContext {
  const formData = options.formData ?? new FormData();
  const url = new URL("http://localhost/api/recipes");
  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return {
    locals: { user: options.user === undefined ? { id: "user-1" } : options.user },
    request: { formData: () => Promise.resolve(formData), headers: new Headers() } as unknown as Request,
    cookies: {} as APIContext["cookies"],
    url,
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
    vi.mocked(listRecipes).mockReset();
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
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient({ reserveResult: { data: false } }) as never);

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));

    expect(response.status).toBe(429);
  });

  it("persists recipe, ingredients, photo, and a success attempt log on a successful extraction", async () => {
    const client = mockSupabaseClient({
      recipeInsert: { data: { id: "recipe-1", name: "Zupa", type: "soup", instructions: "Ugotuj warzywa." } },
    });
    vi.mocked(createClient).mockReturnValue(client as never);
    vi.mocked(extractRecipeFromPhoto).mockResolvedValue({
      success: true,
      name: "Zupa",
      type: "soup",
      ingredients: ["marchew", "cebula"],
      instructions: "Ugotuj warzywa.",
      raw: {},
    });

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));
    const body = (await response.json()) as { success: boolean; recipe: { id: string }; typeUnconfirmed: boolean };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      recipe: {
        id: "recipe-1",
        name: "Zupa",
        type: "soup",
        ingredients: ["marchew", "cebula"],
        instructions: "Ugotuj warzywa.",
        photoUrl: "https://signed.example/photo.jpg",
      },
      typeUnconfirmed: false,
      contentDegraded: false,
    });
    expect(client.upload).toHaveBeenCalledOnce();
    expect(client.recipesChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", name: "Zupa", type: "soup", instructions: "Ugotuj warzywa." }),
    );
    expect(client.ingredientsChain.insert).toHaveBeenCalledWith([
      { recipe_id: "recipe-1", name: "marchew", position: 0 },
      { recipe_id: "recipe-1", name: "cebula", position: 1 },
    ]);
    expect(client.extractionAttemptsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, recipe_id: "recipe-1" }),
    );
  });

  it("filters blank ingredient strings before insert and flags contentDegraded", async () => {
    const client = mockSupabaseClient({
      recipeInsert: { data: { id: "recipe-4", name: "Zupa", type: "soup", instructions: "Ugotuj warzywa." } },
    });
    vi.mocked(createClient).mockReturnValue(client as never);
    vi.mocked(extractRecipeFromPhoto).mockResolvedValue({
      success: true,
      name: "Zupa",
      type: "soup",
      ingredients: ["", "marchew", " "],
      instructions: "Ugotuj warzywa.",
      raw: {},
    });

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));
    const body = (await response.json()) as {
      recipe: { ingredients: string[] };
      contentDegraded: boolean;
    };

    expect(client.ingredientsChain.insert).toHaveBeenCalledWith([
      { recipe_id: "recipe-4", name: "marchew", position: 0 },
    ]);
    expect(body.recipe.ingredients).toEqual(["marchew"]);
    expect(body.contentDegraded).toBe(true);
  });

  it("flags contentDegraded when instructions are missing even with clean ingredients", async () => {
    const client = mockSupabaseClient({
      recipeInsert: { data: { id: "recipe-5", name: "Zupa", type: "soup", instructions: null } },
    });
    vi.mocked(createClient).mockReturnValue(client as never);
    vi.mocked(extractRecipeFromPhoto).mockResolvedValue({
      success: true,
      name: "Zupa",
      type: "soup",
      ingredients: ["marchew", "cebula"],
      instructions: null,
      raw: {},
    });

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));
    const body = (await response.json()) as { contentDegraded: boolean };

    expect(body.contentDegraded).toBe(true);
  });

  it("falls back to 'other' and flags typeUnconfirmed when the model didn't assign a type", async () => {
    const client = mockSupabaseClient({ recipeInsert: { data: { id: "recipe-2", name: "Coś", type: "other" } } });
    vi.mocked(createClient).mockReturnValue(client as never);
    vi.mocked(extractRecipeFromPhoto).mockResolvedValue({
      success: true,
      name: "Coś",
      type: null,
      ingredients: ["składnik"],
      instructions: null,
      raw: {},
    });

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));
    const body = (await response.json()) as { typeUnconfirmed: boolean; recipe: { photoUrl: string | null } };

    expect(body.typeUnconfirmed).toBe(true);
    expect(body.recipe.photoUrl).toBe("https://signed.example/photo.jpg");
    expect(client.recipesChain.insert).toHaveBeenCalledWith(expect.objectContaining({ type: "other" }));
  });

  it("degrades to a null photoUrl instead of failing when signing the photo fails", async () => {
    const client = mockSupabaseClient({
      recipeInsert: { data: { id: "recipe-1", name: "Zupa", type: "soup", instructions: null } },
      signedPhotoUrl: null,
    });
    vi.mocked(createClient).mockReturnValue(client as never);
    vi.mocked(extractRecipeFromPhoto).mockResolvedValue({
      success: true,
      name: "Zupa",
      type: "soup",
      ingredients: ["marchew"],
      instructions: null,
      raw: {},
    });

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));
    const body = (await response.json()) as { recipe: { photoUrl: string | null } };

    expect(response.status).toBe(200);
    expect(body.recipe.photoUrl).toBeNull();
  });

  it("removes the uploaded photo from storage when the recipes insert fails", async () => {
    const client = mockSupabaseClient({ recipeInsert: { data: null, error: { message: "insert failed" } } });
    vi.mocked(createClient).mockReturnValue(client as never);
    vi.mocked(extractRecipeFromPhoto).mockResolvedValue({
      success: true,
      name: "Zupa",
      type: "soup",
      ingredients: ["marchew"],
      instructions: null,
      raw: {},
    });

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));

    expect(response.status).toBe(500);
    expect(client.remove).toHaveBeenCalledOnce();
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
      instructions: null,
      raw: {},
    });

    const response = await POST(makeContext({ formData: photoFormData(samplePhoto()) }));

    expect(response.status).toBe(500);
    expect(client.recipesChain.delete).toHaveBeenCalledOnce();
    expect(client.recipesChain.eq).toHaveBeenCalledWith("id", "recipe-3");
    expect(client.extractionAttemptsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, failure_reason: "technical_error" }),
    );
  });
});

describe("GET /api/recipes", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(listRecipes).mockReset();
  });

  it("returns 401 for an unauthenticated request", async () => {
    const response = await GET(makeContext({ user: null }));

    expect(response.status).toBe(401);
    expect(listRecipes).not.toHaveBeenCalled();
  });

  it("returns 503 when Supabase is not configured", async () => {
    vi.mocked(createClient).mockReturnValue(null);

    const response = await GET(makeContext({}));

    expect(response.status).toBe(503);
  });

  it("forwards an empty query and returns the recipes from the service", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient() as never);
    vi.mocked(listRecipes).mockResolvedValue([
      { id: "recipe-1", name: "Zupa", type: "soup", createdAt: "2026-08-16T00:00:00.000Z", photoUrl: null },
    ]);

    const response = await GET(makeContext({}));
    const body = (await response.json()) as { recipes: unknown[] };

    expect(response.status).toBe(200);
    expect(listRecipes).toHaveBeenCalledWith(expect.anything(), "user-1", {});
    expect(body.recipes).toHaveLength(1);
  });

  it("forwards a trimmed q and a type filter to the service", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient() as never);
    vi.mocked(listRecipes).mockResolvedValue([]);

    await GET(makeContext({ searchParams: { q: "marchewka", type: "soup" } }));

    expect(listRecipes).toHaveBeenCalledWith(expect.anything(), "user-1", { q: "marchewka", type: "soup" });
  });

  it("returns 400 for an invalid type value", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient() as never);

    const response = await GET(makeContext({ searchParams: { type: "not-a-real-type" } }));

    expect(response.status).toBe(400);
    expect(listRecipes).not.toHaveBeenCalled();
  });
});
