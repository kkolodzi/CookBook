import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));

const { POST } = await import("./restore");
const { createClient } = await import("@/lib/supabase");

interface MockConfig {
  updateResult?: { data: { id: string } | null; error?: unknown };
}

function mockSupabaseClient(config: MockConfig = {}) {
  const recipesChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(config.updateResult ?? { data: { id: "recipe-1" }, error: null }),
  };
  const from = vi.fn(() => recipesChain);
  return { from, recipesChain };
}

function makeContext(options: {
  user?: { id: string } | null;
  params?: Record<string, string | undefined>;
}): APIContext {
  return {
    locals: { user: options.user === undefined ? { id: "user-1" } : options.user },
    params: options.params ?? { id: "recipe-1" },
    request: { headers: new Headers() } as unknown as Request,
    cookies: {} as APIContext["cookies"],
  } as unknown as APIContext;
}

describe("POST /api/recipes/[id]/restore", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("returns 401 for an unauthenticated request", async () => {
    const response = await POST(makeContext({ user: null }));

    expect(response.status).toBe(401);
  });

  it("restores a soft-deleted, owned recipe", async () => {
    const client = mockSupabaseClient({ updateResult: { data: { id: "recipe-1" }, error: null } });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await POST(makeContext({}));
    const body = (await response.json()) as { id: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: "recipe-1" });
    expect(client.recipesChain.update).toHaveBeenCalledWith({ deleted_at: null });
    expect(client.recipesChain.not).toHaveBeenCalledWith("deleted_at", "is", null);
  });

  it("returns 404 when the recipe isn't found, owned, or not currently deleted", async () => {
    const client = mockSupabaseClient({ updateResult: { data: null, error: { message: "no rows" } } });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await POST(makeContext({}));

    expect(response.status).toBe(404);
  });
});
