import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, type TestUser } from "./helpers/test-client";
import { listRecipes, getRecipeDetail } from "@/lib/services/recipe-query";

describe("trashed recipe visibility", () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser();
  });

  async function createRecipe(name: string, deletedAt: string | null = null) {
    const photoPath = `${user.userId}/${crypto.randomUUID()}.txt`;
    const { error: uploadError } = await user.client.storage
      .from("recipe-photos")
      .upload(photoPath, new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
    if (uploadError) {
      throw new Error(`Setup upload failed: ${uploadError.message}`);
    }

    const { data: recipe, error: insertError } = await user.client
      .from("recipes")
      .insert({ user_id: user.userId, name, type: "other", photo_path: photoPath, deleted_at: deletedAt })
      .select()
      .single();
    if (insertError) {
      throw new Error(`Setup recipe insert failed: ${insertError.message}`);
    }

    return recipe;
  }

  it("listRecipes() excludes a trashed recipe", async () => {
    const trashedRecipe = await createRecipe("Trashed for listRecipes", new Date().toISOString());
    const activeRecipe = await createRecipe("Active for listRecipes");

    const results = await listRecipes(user.client, user.userId, {});
    const ids = results.map((recipe) => recipe.id);

    expect(ids).not.toContain(trashedRecipe.id);
    expect(ids).toContain(activeRecipe.id);
  });

  it("getRecipeDetail() returns null for a trashed recipe", async () => {
    const trashedRecipe = await createRecipe("Trashed for getRecipeDetail", new Date().toISOString());

    const detail = await getRecipeDetail(user.client, user.userId, trashedRecipe.id);
    expect(detail).toBeNull();
  });

  it("the trash-list query excludes an active recipe", async () => {
    const trashedRecipe = await createRecipe("Trashed for trash-list", new Date().toISOString());
    const activeRecipe = await createRecipe("Active for trash-list");

    const { data, error } = await user.client
      .from("recipes")
      .select("id")
      .eq("user_id", user.userId)
      .not("deleted_at", "is", null);
    expect(error).toBeNull();

    const ids = (data ?? []).map((recipe) => recipe.id);
    expect(ids).toContain(trashedRecipe.id);
    expect(ids).not.toContain(activeRecipe.id);
  });

  it("edit_recipe RPC rejects an edit against a trashed recipe", async () => {
    const trashedRecipe = await createRecipe("Trashed for edit_recipe", new Date().toISOString());
    const { error: ingredientError } = await user.client
      .from("recipe_ingredients")
      .insert({ recipe_id: trashedRecipe.id, name: "Original ingredient", position: 0 });
    if (ingredientError) {
      throw new Error(`Setup ingredient insert failed: ${ingredientError.message}`);
    }

    const { data: editResult, error: editError } = await user.client.rpc("edit_recipe", {
      p_recipe_id: trashedRecipe.id,
      p_name: "Should not apply",
      p_type: "dessert",
      p_ingredients: ["Should not apply either"],
    });
    expect(editError).toBeNull();
    expect(editResult).toBe(false);

    const { data: ingredients, error: ingredientsError } = await user.client
      .from("recipe_ingredients")
      .select("name")
      .eq("recipe_id", trashedRecipe.id);
    expect(ingredientsError).toBeNull();
    expect(ingredients).toEqual([{ name: "Original ingredient" }]);
  });
});
