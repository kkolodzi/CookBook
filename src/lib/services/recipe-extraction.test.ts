import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("astro:env/server", () => ({
  OPENROUTER_API_KEY: "test-api-key",
  OPENROUTER_MODEL: "test-model",
}));

const { extractRecipeFromPhoto } = await import("./recipe-extraction");

function mockFetchResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as Response;
}

function chatCompletion(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

const imageBytes = new ArrayBuffer(8);

describe("extractRecipeFromPhoto", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("maps a well-formed model response to success", async () => {
    const modelPayload = {
      is_recipe: true,
      not_recipe_reason: null,
      name: "Barszcz czerwony",
      type: "soup",
      ingredients: ["buraki", "woda", "sol"],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(chatCompletion(modelPayload))));

    const result = await extractRecipeFromPhoto(imageBytes, "image/jpeg");

    expect(result).toEqual({
      success: true,
      name: "Barszcz czerwony",
      type: "soup",
      ingredients: ["buraki", "woda", "sol"],
      raw: modelPayload,
    });
  });

  it("downgrades a response with no ingredients to incomplete_extraction", async () => {
    const modelPayload = {
      is_recipe: true,
      not_recipe_reason: null,
      name: "Nieznana zupa",
      type: null,
      ingredients: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(chatCompletion(modelPayload))));

    const result = await extractRecipeFromPhoto(imageBytes, "image/jpeg");

    expect(result).toEqual({ success: false, reason: "incomplete_extraction", raw: modelPayload });
  });

  it("maps malformed JSON content to technical_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockFetchResponse({ choices: [{ message: { content: "not json" } }] })),
    );

    const result = await extractRecipeFromPhoto(imageBytes, "image/jpeg");

    expect(result).toEqual({ success: false, reason: "technical_error", raw: "not json" });
  });

  it("maps a timeout to technical_error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );

    const resultPromise = extractRecipeFromPhoto(imageBytes, "image/jpeg");
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result).toEqual({ success: false, reason: "technical_error", raw: null });
    vi.useRealTimers();
  });
});
