import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));

const { GET, PATCH, DELETE } = await import("./index");
const { createClient } = await import("@/lib/supabase");

interface MockConfig {
  recipeSelect?: { data: { id: string; name: string; type: string } | null; error?: unknown };
  ingredientsSelect?: { data: { name: string }[] | null; error?: unknown };
  recipeUpdate?: { data: { id: string } | null; error?: unknown };
  existingIngredientIds?: { data: { id: string }[] | null; error?: unknown };
  insertError?: unknown;
  deleteError?: unknown;
}

function mockSupabaseClient(config: MockConfig = {}) {
  const recipesChain = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() => {
      // GET path uses recipeSelect; PATCH/DELETE use recipeUpdate
      return Promise.resolve(
        recipesChain.update.mock.calls.length > 0
          ? (config.recipeUpdate ?? { data: { id: "recipe-1" }, error: null })
          : (config.recipeSelect ?? { data: { id: "recipe-1", name: "Zupa", type: "soup" }, error: null }),
      );
    }),
  };

  const orderMock = vi.fn().mockResolvedValue(config.ingredientsSelect ?? { data: [], error: null });

  const ingredientsChain = {
    select: vi.fn().mockReturnThis(),
    // Dual-use: PATCH awaits `.eq()` directly (existing ids); GET chains `.order()` after it.
    eq: vi.fn().mockImplementation(() => ({
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(config.existingIngredientIds ?? { data: [], error: null }).then(resolve, reject),
      order: orderMock,
    })),
    order: orderMock,
    insert: vi.fn().mockResolvedValue({ error: config.insertError ?? null }),
    delete: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ error: config.deleteError ?? null }),
  };

  const from = vi.fn((table: string) => {
    if (table === "recipes") return recipesChain;
    if (table === "recipe_ingredients") return ingredientsChain;
    throw new Error(`Unexpected table: ${table}`);
  });

  return { from, recipesChain, ingredientsChain };
}

function makeContext(options: {
  user?: { id: string } | null;
  params?: Record<string, string | undefined>;
  body?: unknown;
}): APIContext {
  return {
    locals: { user: options.user === undefined ? { id: "user-1" } : options.user },
    params: options.params ?? { id: "recipe-1" },
    request: {
      json: () => Promise.resolve(options.body ?? {}),
      headers: new Headers(),
    } as unknown as Request,
    cookies: {} as APIContext["cookies"],
  } as unknown as APIContext;
}

const validPatchBody = { name: "Nowa Zupa", type: "soup", ingredients: ["marchew", "cebula"] };

describe("GET /api/recipes/[id]", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("returns 401 for an unauthenticated request", async () => {
    const response = await GET(makeContext({ user: null }));

    expect(response.status).toBe(401);
  });

  it("returns 404 when the recipe isn't found, owned, or is soft-deleted", async () => {
    const client = mockSupabaseClient({ recipeSelect: { data: null, error: { message: "no rows" } } });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await GET(makeContext({}));

    expect(response.status).toBe(404);
  });

  it("returns the recipe with ordered ingredients", async () => {
    const client = mockSupabaseClient({
      recipeSelect: { data: { id: "recipe-1", name: "Zupa", type: "soup" }, error: null },
      ingredientsSelect: { data: [{ name: "marchew" }, { name: "cebula" }], error: null },
    });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await GET(makeContext({}));
    const body = (await response.json()) as { id: string; ingredients: string[] };

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: "recipe-1", name: "Zupa", type: "soup", ingredients: ["marchew", "cebula"] });
  });
});

describe("PATCH /api/recipes/[id]", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("returns 401 for an unauthenticated request", async () => {
    const response = await PATCH(makeContext({ user: null, body: validPatchBody }));

    expect(response.status).toBe(401);
  });

  it("returns 400 when ingredients is empty", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient() as never);

    const response = await PATCH(makeContext({ body: { ...validPatchBody, ingredients: [] } }));

    expect(response.status).toBe(400);
  });

  it("returns 400 for an invalid type", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient() as never);

    const response = await PATCH(makeContext({ body: { ...validPatchBody, type: "not_a_real_type" } }));

    expect(response.status).toBe(400);
  });

  it("returns 404 when the recipe isn't found, owned, or already soft-deleted", async () => {
    const client = mockSupabaseClient({ recipeUpdate: { data: null, error: { message: "no rows" } } });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await PATCH(makeContext({ body: validPatchBody }));

    expect(response.status).toBe(404);
  });

  it("inserts the new ingredients before deleting the old ones, and returns the updated recipe", async () => {
    const client = mockSupabaseClient({
      recipeUpdate: { data: { id: "recipe-1" }, error: null },
      existingIngredientIds: { data: [{ id: "old-1" }, { id: "old-2" }], error: null },
    });
    vi.mocked(createClient).mockReturnValue(client as never);

    const insertOrder: string[] = [];
    client.ingredientsChain.insert.mockImplementation(() => {
      insertOrder.push("insert");
      return Promise.resolve({ error: null });
    });
    client.ingredientsChain.in.mockImplementation(() => {
      insertOrder.push("delete");
      return Promise.resolve({ error: null });
    });

    const response = await PATCH(makeContext({ body: validPatchBody }));
    const body = (await response.json()) as { name: string; ingredients: string[] };

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: "recipe-1", name: "Nowa Zupa", type: "soup", ingredients: ["marchew", "cebula"] });
    expect(client.recipesChain.update).toHaveBeenCalledWith({ name: "Nowa Zupa", type: "soup" });
    expect(client.ingredientsChain.insert).toHaveBeenCalledWith([
      { recipe_id: "recipe-1", name: "marchew", position: 0 },
      { recipe_id: "recipe-1", name: "cebula", position: 1 },
    ]);
    expect(client.ingredientsChain.in).toHaveBeenCalledWith("id", ["old-1", "old-2"]);
    expect(insertOrder).toEqual(["insert", "delete"]);
  });

  it("skips the delete call when there were no prior ingredients", async () => {
    const client = mockSupabaseClient({
      recipeUpdate: { data: { id: "recipe-1" }, error: null },
      existingIngredientIds: { data: [], error: null },
    });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await PATCH(makeContext({ body: validPatchBody }));

    expect(response.status).toBe(200);
    expect(client.ingredientsChain.in).not.toHaveBeenCalled();
  });

  it("returns 500 when the ingredient insert fails", async () => {
    const client = mockSupabaseClient({
      recipeUpdate: { data: { id: "recipe-1" }, error: null },
      existingIngredientIds: { data: [], error: null },
      insertError: { message: "boom" },
    });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await PATCH(makeContext({ body: validPatchBody }));

    expect(response.status).toBe(500);
  });
});

describe("DELETE /api/recipes/[id]", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("returns 401 for an unauthenticated request", async () => {
    const response = await DELETE(makeContext({ user: null }));

    expect(response.status).toBe(401);
  });

  it("soft-deletes an owned, active recipe", async () => {
    const client = mockSupabaseClient({ recipeUpdate: { data: { id: "recipe-1" }, error: null } });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await DELETE(makeContext({}));
    const body = (await response.json()) as { id: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: "recipe-1" });
    const [updateArg] = client.recipesChain.update.mock.calls[0] as [{ deleted_at: string }];
    expect(typeof updateArg.deleted_at).toBe("string");
  });

  it("returns 404 when the recipe isn't found, owned, or already deleted", async () => {
    const client = mockSupabaseClient({ recipeUpdate: { data: null, error: { message: "no rows" } } });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await DELETE(makeContext({}));

    expect(response.status).toBe(404);
  });
});
