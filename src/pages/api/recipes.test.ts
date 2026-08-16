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

function mockSupabaseClient(count: number, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue({ count, error }),
  };
  return { from: vi.fn().mockReturnValue(builder) };
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
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient(0) as never);
    const file = new File(["data"], "photo.gif", { type: "image/gif" });

    const response = await POST(makeContext({ formData: photoFormData(file) }));

    expect(response.status).toBe(400);
  });

  it("returns 400 for an oversized file", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient(0) as never);
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([oversized], "photo.jpg", { type: "image/jpeg" });

    const response = await POST(makeContext({ formData: photoFormData(file) }));

    expect(response.status).toBe(400);
  });

  it("returns 429 when the daily attempt cap is reached", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient(10) as never);
    const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });

    const response = await POST(makeContext({ formData: photoFormData(file) }));

    expect(response.status).toBe(429);
  });

  it("returns the extraction service's result as JSON for a valid request", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient(0) as never);
    const extractionResult = {
      success: true as const,
      name: "Barszcz czerwony",
      type: "soup" as const,
      ingredients: ["buraki", "woda"],
      raw: {},
    };
    vi.mocked(extractRecipeFromPhoto).mockResolvedValue(extractionResult);
    const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });

    const response = await POST(makeContext({ formData: photoFormData(file) }));
    const body = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(body).toEqual(extractionResult);
  });
});
