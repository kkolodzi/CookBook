import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { RECIPE_TYPE_VALUES } from "@/components/recipes/recipe-type-labels";

export const prerender = false;

const patchSchema = z.object({
  type: z.enum(RECIPE_TYPE_VALUES, { message: "Nieprawidłowy typ dania." }),
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const PATCH: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse({ error: "Musisz się zalogować, aby edytować przepis." }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Usługa jest tymczasowo niedostępna." }, 503);
  }

  const id = context.params.id;
  if (!id) {
    return jsonResponse({ error: "Brak identyfikatora przepisu." }, 400);
  }

  const rawBody: unknown = await context.request.json().catch(() => null);
  const parsedBody = patchSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return jsonResponse({ error: parsedBody.error.issues[0].message }, 400);
  }

  const { data, error } = await supabase
    .from("recipes")
    .update({ type: parsedBody.data.type })
    .eq("id", id)
    .select("type")
    .single();

  if (error) {
    return jsonResponse({ error: "Nie znaleziono przepisu." }, 404);
  }

  return jsonResponse({ type: data.type }, 200);
};
