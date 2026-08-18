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
      instructions: "Ugotuj buraki w wodzie z solą, następnie zmiksuj i podawaj na gorąco.",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(chatCompletion(modelPayload))));

    const result = await extractRecipeFromPhoto(imageBytes, "image/jpeg");

    expect(result).toEqual({
      success: true,
      name: "Barszcz czerwony",
      type: "soup",
      ingredients: ["buraki", "woda", "sol"],
      instructions: "Ugotuj buraki w wodzie z solą, następnie zmiksuj i podawaj na gorąco.",
      raw: modelPayload,
    });
  });

  it("maps a well-formed model response with no visible instructions to success with instructions null", async () => {
    const modelPayload = {
      is_recipe: true,
      not_recipe_reason: null,
      name: "Sałatka jarzynowa",
      type: "salad",
      ingredients: ["ziemniaki", "marchew", "groszek"],
      instructions: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(chatCompletion(modelPayload))));

    const result = await extractRecipeFromPhoto(imageBytes, "image/jpeg");

    expect(result).toEqual({
      success: true,
      name: "Sałatka jarzynowa",
      type: "salad",
      ingredients: ["ziemniaki", "marchew", "groszek"],
      instructions: null,
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
      instructions: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(chatCompletion(modelPayload))));

    const result = await extractRecipeFromPhoto(imageBytes, "image/jpeg");

    expect(result).toEqual({ success: false, reason: "incomplete_extraction", raw: modelPayload });
  });

  it("downgrades a response whose ingredients are all blank strings to incomplete_extraction", async () => {
    const modelPayload = {
      is_recipe: true,
      not_recipe_reason: null,
      name: "Nieznana zupa",
      type: null,
      ingredients: ["", "   "],
      instructions: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(chatCompletion(modelPayload))));

    const result = await extractRecipeFromPhoto(imageBytes, "image/jpeg");

    expect(result).toEqual({ success: false, reason: "incomplete_extraction", raw: modelPayload });
  });

  it("passes through a partial-blank ingredients array unfiltered as a success", async () => {
    const modelPayload = {
      is_recipe: true,
      not_recipe_reason: null,
      name: "Nieznana zupa",
      type: null,
      ingredients: ["", "mąka"],
      instructions: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(chatCompletion(modelPayload))));

    const result = await extractRecipeFromPhoto(imageBytes, "image/jpeg");

    expect(result).toEqual({
      success: true,
      name: "Nieznana zupa",
      type: null,
      ingredients: ["", "mąka"],
      instructions: null,
      raw: modelPayload,
    });
  });

  it("maps a structurally wrong-shaped ingredients field to technical_error", async () => {
    const parsedContent = {
      is_recipe: true,
      not_recipe_reason: null,
      name: "Zupa",
      type: "soup",
      ingredients: "not-an-array",
      instructions: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(chatCompletion(parsedContent))));

    const result = await extractRecipeFromPhoto(imageBytes, "image/jpeg");

    expect(result).toEqual({ success: false, reason: "technical_error", raw: parsedContent });
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
