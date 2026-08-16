import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse({ error: "Musisz się zalogować, aby przywrócić przepis." }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Usługa jest tymczasowo niedostępna." }, 503);
  }

  const id = context.params.id;
  if (!id) {
    return jsonResponse({ error: "Brak identyfikatora przepisu." }, 400);
  }

  const { data, error } = await supabase
    .from("recipes")
    .update({ deleted_at: null })
    .eq("id", id)
    .not("deleted_at", "is", null)
    .select("id")
    .single();

  if (error) {
    return jsonResponse({ error: "Nie znaleziono przepisu w koszu." }, 404);
  }

  return jsonResponse({ id: data.id }, 200);
};
