import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));

const { GET } = await import("./trash");
const { createClient } = await import("@/lib/supabase");

function mockSupabaseClient(config: { data?: unknown[] | null; error?: unknown } = {}) {
  const recipesChain = {
    select: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: config.data ?? [], error: config.error ?? null }),
  };
  const from = vi.fn(() => recipesChain);
  return { from, recipesChain };
}

function makeContext(user?: { id: string } | null): APIContext {
  return {
    locals: { user: user === undefined ? { id: "user-1" } : user },
    request: { headers: new Headers() } as unknown as Request,
    cookies: {} as APIContext["cookies"],
  } as unknown as APIContext;
}

describe("GET /api/recipes/trash", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("returns 401 for an unauthenticated request", async () => {
    const response = await GET(makeContext(null));

    expect(response.status).toBe(401);
  });

  it("returns soft-deleted recipes, newest-removed-first, mapped to camelCase", async () => {
    const client = mockSupabaseClient({
      data: [{ id: "r1", name: "Zupa", type: "soup", deleted_at: "2026-08-16T10:00:00Z" }],
    });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await GET(makeContext());
    const body = (await response.json()) as { recipes: { id: string; deletedAt: string }[] };

    expect(response.status).toBe(200);
    expect(body.recipes).toEqual([{ id: "r1", name: "Zupa", type: "soup", deletedAt: "2026-08-16T10:00:00Z" }]);
    expect(client.recipesChain.not).toHaveBeenCalledWith("deleted_at", "is", null);
    expect(client.recipesChain.order).toHaveBeenCalledWith("deleted_at", { ascending: false });
  });

  it("returns 500 when the query fails", async () => {
    const client = mockSupabaseClient({ error: { message: "boom" } });
    vi.mocked(createClient).mockReturnValue(client as never);

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
  });
});
