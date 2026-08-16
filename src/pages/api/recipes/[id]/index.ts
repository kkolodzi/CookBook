import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { RECIPE_TYPE_VALUES } from "@/components/recipes/recipe-type-labels";

export const prerender = false;

const patchSchema = z.object({
  name: z.string().trim().min(1, "Podaj nazwę przepisu."),
  type: z.enum(RECIPE_TYPE_VALUES, { message: "Nieprawidłowy typ dania." }),
  ingredients: z.array(z.string().trim().min(1)).min(1, "Podaj co najmniej jeden składnik."),
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const GET: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse({ error: "Musisz się zalogować, aby zobaczyć przepis." }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Usługa jest tymczasowo niedostępna." }, 503);
  }

  const id = context.params.id;
  if (!id) {
    return jsonResponse({ error: "Brak identyfikatora przepisu." }, 400);
  }

  const { data: recipe, error: recipeError } = await supabase
    .from("recipes")
    .select("id, name, type")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (recipeError) {
    return jsonResponse({ error: "Nie znaleziono przepisu." }, 404);
  }

  const { data: ingredients, error: ingredientsError } = await supabase
    .from("recipe_ingredients")
    .select("name")
    .eq("recipe_id", id)
    .order("position", { ascending: true });

  if (ingredientsError) {
    return jsonResponse({ error: "Wystąpił błąd. Spróbuj ponownie." }, 500);
  }

  return jsonResponse(
    { id: recipe.id, name: recipe.name, type: recipe.type, ingredients: ingredients.map((i) => i.name) },
    200,
  );
};

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
  const { name, type, ingredients } = parsedBody.data;

  const { error: updateError } = await supabase
    .from("recipes")
    .update({ name, type })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .single();

  if (updateError) {
    return jsonResponse({ error: "Nie znaleziono przepisu." }, 404);
  }

  const { data: existingIngredients, error: existingError } = await supabase
    .from("recipe_ingredients")
    .select("id")
    .eq("recipe_id", id);

  if (existingError) {
    return jsonResponse({ error: "Wystąpił błąd podczas zapisu składników. Spróbuj ponownie." }, 500);
  }

  const newIngredientRows = ingredients.map((ingredientName, position) => ({
    recipe_id: id,
    name: ingredientName,
    position,
  }));

  const { error: insertError } = await supabase.from("recipe_ingredients").insert(newIngredientRows);

  if (insertError) {
    return jsonResponse({ error: "Wystąpił błąd podczas zapisu składników. Spróbuj ponownie." }, 500);
  }

  const oldIds = existingIngredients.map((i) => i.id);
  if (oldIds.length > 0) {
    const { error: deleteError } = await supabase.from("recipe_ingredients").delete().in("id", oldIds);
    if (deleteError) {
      return jsonResponse({ error: "Wystąpił błąd podczas zapisu składników. Spróbuj ponownie." }, 500);
    }
  }

  return jsonResponse({ id, name, type, ingredients }, 200);
};

export const DELETE: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse({ error: "Musisz się zalogować, aby usunąć przepis." }, 401);
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
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .single();

  if (error) {
    return jsonResponse({ error: "Nie znaleziono przepisu." }, 404);
  }

  return jsonResponse({ id: data.id }, 200);
};
