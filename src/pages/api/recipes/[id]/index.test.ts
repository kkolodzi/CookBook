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
  rpcResult?: { data: boolean | null; error?: unknown };
}

function mockSupabaseClient(config: MockConfig = {}) {
  const recipesChain = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi
      .fn()
      .mockResolvedValue(
        config.recipeSelect ??
          config.recipeUpdate ?? { data: { id: "recipe-1", name: "Zupa", type: "soup" }, error: null },
      ),
  };

  const ingredientsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(config.ingredientsSelect ?? { data: [], error: null }),
  };

  const from = vi.fn((table: string) => {
    if (table === "recipes") return recipesChain;
    if (table === "recipe_ingredients") return ingredientsChain;
    throw new Error(`Unexpected table: ${table}`);
  });

  const rpc = vi.fn().mockResolvedValue(config.rpcResult ?? { data: true, error: null });

  return { from, rpc, recipesChain, ingredientsChain };
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

  it("calls the atomic edit_recipe RPC and returns the updated recipe on success", async () => {
    const client = mockSupabaseClient({ rpcResult: { data: true, error: null } });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await PATCH(makeContext({ body: validPatchBody }));
    const body = (await response.json()) as { id: string; name: string; ingredients: string[] };

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: "recipe-1", name: "Nowa Zupa", type: "soup", ingredients: ["marchew", "cebula"] });
    expect(client.rpc).toHaveBeenCalledWith("edit_recipe", {
      p_recipe_id: "recipe-1",
      p_name: "Nowa Zupa",
      p_type: "soup",
      p_ingredients: ["marchew", "cebula"],
    });
  });

  it("returns 404 when the RPC reports the recipe wasn't found, owned, or already soft-deleted", async () => {
    const client = mockSupabaseClient({ rpcResult: { data: false, error: null } });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await PATCH(makeContext({ body: validPatchBody }));

    expect(response.status).toBe(404);
  });

  it("returns 500 when the RPC errors", async () => {
    const client = mockSupabaseClient({ rpcResult: { data: null, error: { message: "boom" } } });
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
