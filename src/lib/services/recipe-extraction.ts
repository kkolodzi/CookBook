import { z } from "zod";
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from "astro:env/server";
import type { Database } from "@/types";

export type RecipeTypeValue = Database["public"]["Enums"]["recipe_type"];
export type ExtractionFailureReason = Database["public"]["Enums"]["extraction_failure_reason"];

export type ExtractionResult =
  | { success: true; name: string; type: RecipeTypeValue | null; ingredients: string[]; raw: unknown }
  | { success: false; reason: ExtractionFailureReason; raw: unknown };

const EXTRACTION_TIMEOUT_MS = 10_000;
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const SUPPORTED_MIME_TYPES: readonly string[] = ["image/jpeg", "image/png"];

const RECIPE_TYPES = [
  "dessert",
  "soup",
  "main_course",
  "salad",
  "breakfast",
  "snack",
  "drink",
  "other",
] as const satisfies readonly RecipeTypeValue[];

// The four reasons the model can self-report; `incomplete_extraction` and `technical_error`
// are never returned by the model — they're derived by this service (floor check / call failure).
const MODEL_FAILURE_REASONS = [
  "not_a_recipe",
  "blurry_or_low_light",
  "cut_off_or_partial",
  "handwriting_illegible",
] as const satisfies readonly ExtractionFailureReason[];

const modelResponseSchema = z
  .object({
    is_recipe: z.boolean(),
    not_recipe_reason: z.enum(MODEL_FAILURE_REASONS).nullable(),
    name: z.string().nullable(),
    type: z.enum(RECIPE_TYPES).nullable(),
    ingredients: z.array(z.string()),
  })
  .refine((value) => value.is_recipe || value.not_recipe_reason !== null, {
    message: "not_recipe_reason is required when is_recipe is false",
  });

const EXTRACTION_PROMPT = `You are extracting a recipe from a photo of a physical recipe (a cookbook page, a handwritten card, or a printed sheet). The recipe text is very likely in Polish — extract it exactly as written in the source language, do not translate it.

Respond with ONLY a single JSON object (no markdown, no code fences, no commentary) matching this exact shape:
{
  "is_recipe": boolean, // true if the photo shows recipe content (a dish name and/or ingredients), false otherwise
  "not_recipe_reason": one of "not_a_recipe" | "blurry_or_low_light" | "cut_off_or_partial" | "handwriting_illegible", or null when is_recipe is true.
    - "not_a_recipe": the photo doesn't show recipe content at all (e.g. an unrelated object, person, or document)
    - "blurry_or_low_light": the image is too blurry or too dark to read reliably
    - "cut_off_or_partial": part of the recipe is visible but cut off or out of frame
    - "handwriting_illegible": handwritten text is present but cannot be reliably deciphered
  "name": the recipe's dish name as written in the source, or null if it cannot be determined,
  "type": your best-guess meal type, one of "dessert" | "soup" | "main_course" | "salad" | "breakfast" | "snack" | "drink" | "other" — or null if you are not reasonably confident,
  "ingredients": an array of individual ingredient strings as written in the source, each ingredient as its own array entry (keep quantities if present); an empty array if none could be read
}

Only set is_recipe to false if you genuinely cannot extract a name and at least one ingredient.`;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function meetsFloor(name: string | null, ingredients: string[]): name is string {
  return Boolean(name && name.trim().length > 0 && ingredients.length >= 1);
}

export async function extractRecipeFromPhoto(imageBytes: ArrayBuffer, mimeType: string): Promise<ExtractionResult> {
  if (!OPENROUTER_API_KEY || !SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return { success: false, reason: "technical_error", raw: null };
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const dataUrl = `data:${mimeType};base64,${arrayBufferToBase64(imageBytes)}`;
    const controller = new AbortController();
    timeoutId = setTimeout(() => {
      controller.abort();
    }, EXTRACTION_TIMEOUT_MS);

    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        response_format: { type: "json_object" },
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: EXTRACTION_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 2000);
      return { success: false, reason: "technical_error", raw: { status: response.status, body } };
    }

    const body = (await response.json()) as unknown;
    const content = (body as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { success: false, reason: "technical_error", raw: body };
    }

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      return { success: false, reason: "technical_error", raw: content };
    }

    const parsed = modelResponseSchema.safeParse(parsedContent);
    if (!parsed.success) {
      return { success: false, reason: "technical_error", raw: parsedContent };
    }

    const { is_recipe, not_recipe_reason, name, type, ingredients } = parsed.data;

    if (!is_recipe) {
      // Schema refinement guarantees not_recipe_reason is set whenever is_recipe is false.
      return { success: false, reason: not_recipe_reason as ExtractionFailureReason, raw: parsedContent };
    }

    if (!meetsFloor(name, ingredients)) {
      return { success: false, reason: "incomplete_extraction", raw: parsedContent };
    }

    return { success: true, name, type, ingredients, raw: parsedContent };
  } catch {
    // Covers AbortError (timeout) and any network-level failure.
    return { success: false, reason: "technical_error", raw: null };
  } finally {
    clearTimeout(timeoutId);
  }
}
