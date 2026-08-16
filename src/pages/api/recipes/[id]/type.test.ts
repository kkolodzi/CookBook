import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));

const { PATCH } = await import("./type");
const { createClient } = await import("@/lib/supabase");

interface MockSupabaseConfig {
  updateResult?: { data: { type: string } | null; error?: unknown };
}

function mockSupabaseClient(config: MockSupabaseConfig = {}) {
  const recipesChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(config.updateResult ?? { data: { type: "soup" }, error: null }),
  };

  const from = vi.fn(() => recipesChain);

  return { from, recipesChain };
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
      json: () => Promise.resolve(options.body ?? { type: "soup" }),
      headers: new Headers(),
    } as unknown as Request,
    cookies: {} as APIContext["cookies"],
  } as unknown as APIContext;
}

describe("PATCH /api/recipes/[id]/type", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("returns 401 for an unauthenticated request", async () => {
    const response = await PATCH(makeContext({ user: null }));

    expect(response.status).toBe(401);
  });

  it("returns 400 for an invalid type value", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient() as never);

    const response = await PATCH(makeContext({ body: { type: "not_a_real_type" } }));

    expect(response.status).toBe(400);
  });

  it("updates the type and returns 200 when the requesting user owns the recipe", async () => {
    const client = mockSupabaseClient({ updateResult: { data: { type: "soup" }, error: null } });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await PATCH(makeContext({ body: { type: "soup" } }));
    const body = (await response.json()) as { type: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ type: "soup" });
    expect(client.recipesChain.update).toHaveBeenCalledWith({ type: "soup" });
    expect(client.recipesChain.eq).toHaveBeenCalledWith("id", "recipe-1");
  });

  it("returns 404 when RLS blocks the update for a non-owning user", async () => {
    const client = mockSupabaseClient({ updateResult: { data: null, error: { message: "no rows" } } });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await PATCH(makeContext({ body: { type: "soup" } }));

    expect(response.status).toBe(404);
  });
});
