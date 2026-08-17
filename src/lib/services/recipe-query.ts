import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, RecipeDetailDto, RecipeIngredientDto, RecipeSummaryDto } from "@/types";

type RecipeTypeValue = Database["public"]["Enums"]["recipe_type"];

export const RECIPE_PHOTOS_BUCKET = "recipe-photos";
export const SIGNED_URL_TTL_SECONDS = 3600;
const LIST_RESULT_CAP = 200;

interface ListRecipesParams {
  q?: string;
  type?: RecipeTypeValue;
}

interface RecipeRow {
  id: string;
  name: string;
  type: RecipeTypeValue;
  photo_path: string;
  created_at: string;
}

async function signPhotoUrls(supabase: SupabaseClient<Database>, paths: string[]): Promise<Map<string, string | null>> {
  const signedByPath = new Map<string, string | null>();
  if (paths.length === 0) {
    return signedByPath;
  }

  const { data, error } = await supabase.storage
    .from(RECIPE_PHOTOS_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

  if (error) {
    for (const path of paths) {
      signedByPath.set(path, null);
    }
    return signedByPath;
  }

  for (const entry of data) {
    signedByPath.set(entry.path ?? "", entry.error ? null : (entry.signedUrl ?? null));
  }
  return signedByPath;
}

export async function listRecipes(
  supabase: SupabaseClient<Database>,
  userId: string,
  params: ListRecipesParams,
): Promise<RecipeSummaryDto[]> {
  const trimmedQuery = params.q?.trim();
  const hasQuery = Boolean(trimmedQuery);

  let query = supabase
    .from("recipes")
    .select(
      hasQuery
        ? "id, name, type, photo_path, created_at, recipe_ingredients!inner(name)"
        : "id, name, type, photo_path, created_at",
    )
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(LIST_RESULT_CAP);

  if (trimmedQuery) {
    const escapedQuery = trimmedQuery.replace(/[\\%_]/g, (match) => `\\${match}`);
    query = query.ilike("recipe_ingredients.name", `%${escapedQuery}%`);
  }
  if (params.type) {
    query = query.eq("type", params.type);
  }

  const { data, error } = await query;
  if (error) {
    return [];
  }

  const rows = data as unknown as RecipeRow[];
  const signedByPath = await signPhotoUrls(
    supabase,
    rows.map((row) => row.photo_path),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    createdAt: row.created_at,
    photoUrl: signedByPath.get(row.photo_path) ?? null,
  }));
}

export async function getRecipeDetail(
  supabase: SupabaseClient<Database>,
  userId: string,
  recipeId: string,
): Promise<RecipeDetailDto | null> {
  const { data: recipe, error: recipeError } = await supabase
    .from("recipes")
    .select("id, name, type, photo_path, created_at, instructions")
    .eq("id", recipeId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (recipeError || !recipe) {
    return null;
  }

  const { data: ingredientRows, error: ingredientsError } = await supabase
    .from("recipe_ingredients")
    .select("id, name, position")
    .eq("recipe_id", recipe.id)
    .order("position", { ascending: true });

  if (ingredientsError) {
    return null;
  }

  const ingredients: RecipeIngredientDto[] = (ingredientRows as RecipeIngredientDto[]).map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
  }));

  let photoUrl: string | null = null;
  const { data: signedData, error: signedError } = await supabase.storage
    .from(RECIPE_PHOTOS_BUCKET)
    .createSignedUrl(recipe.photo_path, SIGNED_URL_TTL_SECONDS);
  if (!signedError) {
    photoUrl = signedData.signedUrl;
  }

  return {
    id: recipe.id,
    name: recipe.name,
    type: recipe.type,
    createdAt: recipe.created_at,
    photoUrl,
    ingredients,
    instructions: recipe.instructions,
  };
}
