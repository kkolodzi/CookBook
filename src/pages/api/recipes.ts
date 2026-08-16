import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { extractRecipeFromPhoto, SUPPORTED_MIME_TYPES } from "@/lib/services/recipe-extraction";
import type { Json } from "@/types";

export const prerender = false;

const DAILY_ATTEMPT_CAP = 10;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const photoSchema = z
  .instanceof(File, { message: "Brak pliku zdjęcia." })
  .refine((file) => SUPPORTED_MIME_TYPES.includes(file.type), {
    message: "Nieobsługiwany format pliku — dozwolone są JPEG i PNG.",
  })
  .refine((file) => file.size > 0 && file.size <= MAX_FILE_SIZE_BYTES, {
    message: "Plik jest za duży — maksymalny rozmiar to 5MB.",
  });

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function extensionFromMimeType(mimeType: string): string {
  return mimeType === "image/png" ? "png" : "jpg";
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse({ error: "Musisz się zalogować, aby dodać przepis." }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Usługa jest tymczasowo niedostępna." }, 503);
  }

  let formData: FormData;
  try {
    formData = await context.request.formData();
  } catch {
    return jsonResponse({ error: "Wystąpił błąd. Spróbuj ponownie." }, 500);
  }
  const parsedPhoto = photoSchema.safeParse(formData.get("photo"));
  if (!parsedPhoto.success) {
    return jsonResponse({ error: parsedPhoto.error.issues[0].message }, 400);
  }
  const photo = parsedPhoto.data;

  const { data: withinCap, error: capError } = await supabase.rpc("reserve_extraction_attempt", {
    p_cap: DAILY_ATTEMPT_CAP,
  });

  if (capError) {
    return jsonResponse({ error: "Wystąpił błąd. Spróbuj ponownie." }, 500);
  }

  if (!withinCap) {
    return jsonResponse(
      { error: "Osiągnięto dzienny limit 10 prób rozpoznawania przepisów. Spróbuj ponownie jutro." },
      429,
    );
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await photo.arrayBuffer();
  } catch {
    return jsonResponse({ error: "Wystąpił błąd. Spróbuj ponownie." }, 500);
  }
  const result = await extractRecipeFromPhoto(bytes, photo.type);

  if (!result.success) {
    await supabase.from("extraction_attempts").insert({
      user_id: user.id,
      success: false,
      failure_reason: result.reason,
      raw_response: result.raw as Json,
    });
    return jsonResponse({ success: false, reason: result.reason }, 200);
  }

  const storagePath = `${user.id}/${crypto.randomUUID()}.${extensionFromMimeType(photo.type)}`;
  const { error: uploadError } = await supabase.storage
    .from("recipe-photos")
    .upload(storagePath, bytes, { contentType: photo.type });

  if (uploadError) {
    return jsonResponse({ error: "Wystąpił błąd podczas zapisu zdjęcia. Spróbuj ponownie." }, 500);
  }

  const { data: recipeRow, error: recipeError } = await supabase
    .from("recipes")
    .insert({ user_id: user.id, name: result.name, type: result.type ?? "other", photo_path: storagePath })
    .select("id, name, type")
    .single();

  if (recipeError) {
    await supabase.storage.from("recipe-photos").remove([storagePath]);
    return jsonResponse({ error: "Wystąpił błąd podczas zapisu przepisu. Spróbuj ponownie." }, 500);
  }

  const ingredientRows = result.ingredients.map((name, position) => ({
    recipe_id: recipeRow.id,
    name,
    position,
  }));

  const { error: ingredientsError } = await supabase.from("recipe_ingredients").insert(ingredientRows);

  if (ingredientsError) {
    const { error: deleteError } = await supabase.from("recipes").delete().eq("id", recipeRow.id);
    await supabase.from("extraction_attempts").insert({
      user_id: user.id,
      success: false,
      failure_reason: "technical_error",
      raw_response: result.raw as Json,
    });
    if (deleteError) {
      return jsonResponse({ error: "Wystąpił błąd podczas zapisu przepisu. Skontaktuj się z pomocą." }, 500);
    }
    return jsonResponse({ error: "Wystąpił błąd podczas zapisu składników. Spróbuj ponownie." }, 500);
  }

  await supabase.from("extraction_attempts").insert({
    user_id: user.id,
    success: true,
    raw_response: result.raw as Json,
    recipe_id: recipeRow.id,
  });

  return jsonResponse(
    {
      success: true,
      recipe: { id: recipeRow.id, name: recipeRow.name, type: recipeRow.type, ingredients: result.ingredients },
      typeUnconfirmed: result.type === null,
    },
    200,
  );
};
