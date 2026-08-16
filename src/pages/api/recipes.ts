import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { extractRecipeFromPhoto, SUPPORTED_MIME_TYPES } from "@/lib/services/recipe-extraction";

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

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse({ error: "Musisz się zalogować, aby dodać przepis." }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Usługa jest tymczasowo niedostępna." }, 503);
  }

  const formData = await context.request.formData();
  const parsedPhoto = photoSchema.safeParse(formData.get("photo"));
  if (!parsedPhoto.success) {
    return jsonResponse({ error: parsedPhoto.error.issues[0].message }, 400);
  }
  const photo = parsedPhoto.data;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count, error: countError } = await supabase
    .from("extraction_attempts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", todayStart.toISOString());

  if (countError) {
    return jsonResponse({ error: "Wystąpił błąd. Spróbuj ponownie." }, 500);
  }

  if ((count ?? 0) >= DAILY_ATTEMPT_CAP) {
    return jsonResponse(
      { error: "Osiągnięto dzienny limit 10 prób rozpoznawania przepisów. Spróbuj ponownie jutro." },
      429,
    );
  }

  const bytes = await photo.arrayBuffer();
  const result = await extractRecipeFromPhoto(bytes, photo.type);

  return jsonResponse(result, 200);
};
