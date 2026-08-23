import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, type TestUser } from "./helpers/test-client";

describe("trash/restore round-trip", () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser();
  });

  async function createRecipeWithIngredients(name: string, ingredientNames: string[]) {
    const photoPath = `${user.userId}/${crypto.randomUUID()}.txt`;
    const { error: uploadError } = await user.client.storage
      .from("recipe-photos")
      .upload(photoPath, new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
    if (uploadError) {
      throw new Error(`Setup upload failed: ${uploadError.message}`);
    }

    const { data: recipe, error: insertError } = await user.client
      .from("recipes")
      .insert({ user_id: user.userId, name, type: "other", instructions: "Mix well.", photo_path: photoPath })
      .select()
      .single();
    if (insertError) {
      throw new Error(`Setup recipe insert failed: ${insertError.message}`);
    }

    if (ingredientNames.length > 0) {
      const { error: ingredientsError } = await user.client
        .from("recipe_ingredients")
        .insert(
          ingredientNames.map((ingredientName, position) => ({ recipe_id: recipe.id, name: ingredientName, position })),
        );
      if (ingredientsError) {
        throw new Error(`Setup ingredients insert failed: ${ingredientsError.message}`);
      }
    }

    return recipe;
  }

  async function getIngredients(recipeId: string) {
    const { data, error } = await user.client
      .from("recipe_ingredients")
      .select("name, position")
      .eq("recipe_id", recipeId)
      .order("position", { ascending: true });
    if (error) {
      throw new Error(`Fetching ingredients failed: ${error.message}`);
    }
    return data;
  }

  async function trash(recipeId: string) {
    return user.client
      .from("recipes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", recipeId)
      .is("deleted_at", null)
      .select("id")
      .single();
  }

  async function restore(recipeId: string) {
    return user.client
      .from("recipes")
      .update({ deleted_at: null })
      .eq("id", recipeId)
      .not("deleted_at", "is", null)
      .select("id")
      .single();
  }

  it("a trash -> restore round-trip preserves all recipe fields and ingredients", async () => {
    const recipe = await createRecipeWithIngredients("Round-trip recipe", ["Flour", "Sugar"]);
    const originalIngredients = await getIngredients(recipe.id);

    const { error: trashError } = await trash(recipe.id);
    expect(trashError).toBeNull();

    const { data: trashedRow } = await user.client.from("recipes").select("deleted_at").eq("id", recipe.id).single();
    expect(trashedRow?.deleted_at).not.toBeNull();

    const { error: restoreError } = await restore(recipe.id);
    expect(restoreError).toBeNull();

    const { data: restored, error: restoredError } = await user.client
      .from("recipes")
      .select("name, type, instructions, photo_path, created_at, deleted_at")
      .eq("id", recipe.id)
      .single();
    expect(restoredError).toBeNull();
    expect(restored).toMatchObject({
      name: recipe.name,
      type: recipe.type,
      instructions: recipe.instructions,
      photo_path: recipe.photo_path,
      created_at: recipe.created_at,
      deleted_at: null,
    });

    const restoredIngredients = await getIngredients(recipe.id);
    expect(restoredIngredients).toEqual(originalIngredients);
  });

  it("an edit -> trash -> restore round-trip preserves the post-edit ingredient set and positions", async () => {
    const recipe = await createRecipeWithIngredients("Edit-then-trash recipe", ["Flour"]);

    const { data: editResult, error: editError } = await user.client.rpc("edit_recipe", {
      p_recipe_id: recipe.id,
      p_name: "Edit-then-trash recipe (edited)",
      p_type: "dessert",
      p_ingredients: ["Butter", "Sugar", "Vanilla"],
    });
    expect(editError).toBeNull();
    expect(editResult).toBe(true);

    const postEditIngredients = await getIngredients(recipe.id);
    expect(postEditIngredients.map((i) => i.name)).toEqual(["Butter", "Sugar", "Vanilla"]);

    const { error: trashError } = await trash(recipe.id);
    expect(trashError).toBeNull();

    const { error: restoreError } = await restore(recipe.id);
    expect(restoreError).toBeNull();

    const { data: restoredRecipe, error: restoredError } = await user.client
      .from("recipes")
      .select("name, type")
      .eq("id", recipe.id)
      .single();
    expect(restoredError).toBeNull();
    expect(restoredRecipe).toMatchObject({ name: "Edit-then-trash recipe (edited)", type: "dessert" });

    const finalIngredients = await getIngredients(recipe.id);
    expect(finalIngredients).toEqual(postEditIngredients);
  });

  it("double-trashing an already-trashed recipe is rejected, not a silent no-op", async () => {
    const recipe = await createRecipeWithIngredients("Double-trash recipe", []);

    const { error: firstTrashError } = await trash(recipe.id);
    expect(firstTrashError).toBeNull();

    const { data: afterFirstTrash } = await user.client
      .from("recipes")
      .select("deleted_at")
      .eq("id", recipe.id)
      .single();
    const firstDeletedAt = afterFirstTrash?.deleted_at;

    const { data: secondTrashData, error: secondTrashError } = await trash(recipe.id);
    expect(secondTrashData).toBeNull();
    expect(secondTrashError).not.toBeNull();

    const { data: stillTrashed } = await user.client.from("recipes").select("deleted_at").eq("id", recipe.id).single();
    expect(stillTrashed?.deleted_at).toBe(firstDeletedAt);
  });

  it("double-restoring an already-active (or never-trashed) recipe is rejected, not a silent no-op", async () => {
    const recipe = await createRecipeWithIngredients("Double-restore recipe", []);

    const { data: restoreData, error: restoreError } = await restore(recipe.id);
    expect(restoreData).toBeNull();
    expect(restoreError).not.toBeNull();

    const { data: stillActive } = await user.client.from("recipes").select("deleted_at").eq("id", recipe.id).single();
    expect(stillActive?.deleted_at).toBeNull();
  });
});
