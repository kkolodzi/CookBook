import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const GET: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse({ error: "Musisz się zalogować, aby zobaczyć kosz." }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Usługa jest tymczasowo niedostępna." }, 503);
  }

  const { data, error } = await supabase
    .from("recipes")
    .select("id, name, type, deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  if (error) {
    return jsonResponse({ error: "Wystąpił błąd. Spróbuj ponownie." }, 500);
  }

  return jsonResponse(
    { recipes: data.map((r) => ({ id: r.id, name: r.name, type: r.type, deletedAt: r.deleted_at })) },
    200,
  );
};
