import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, type TestUser } from "./helpers/test-client";
import type { Database } from "@/types";

type RecipeType = Database["public"]["Enums"]["recipe_type"];

describe("Polish ingredient search (search_recipes_by_ingredient)", () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser();
  });

  async function createRecipeWithIngredient(name: string, ingredientName: string, type: RecipeType = "other") {
    const photoPath = `${user.userId}/${crypto.randomUUID()}.txt`;
    const { error: uploadError } = await user.client.storage
      .from("recipe-photos")
      .upload(photoPath, new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
    if (uploadError) {
      throw new Error(`Setup upload failed: ${uploadError.message}`);
    }

    const { data: recipe, error: insertError } = await user.client
      .from("recipes")
      .insert({ user_id: user.userId, name, type, photo_path: photoPath })
      .select()
      .single();
    if (insertError) {
      throw new Error(`Setup recipe insert failed: ${insertError.message}`);
    }

    const { error: ingredientError } = await user.client
      .from("recipe_ingredients")
      .insert({ recipe_id: recipe.id, name: ingredientName, position: 0 });
    if (ingredientError) {
      throw new Error(`Setup ingredient insert failed: ${ingredientError.message}`);
    }

    return recipe;
  }

  async function searchByIngredient(query: string, type?: RecipeType) {
    const { data, error } = await user.client.rpc("search_recipes_by_ingredient", {
      p_query: query,
      p_type: type,
    });
    if (error) {
      throw new Error(`search_recipes_by_ingredient failed: ${error.message}`);
    }
    return data;
  }

  const declensionPairs: [string, string][] = [
    ["cukier", "170 g cukru"],
    ["masło", "160 g masła"],
    ["mąka", "190 g mąki"],
    ["cytryna", "skórka otarta z 2 cytryn"],
    ["sól", "łyżeczka soli"],
    ["sok", "2 łyżki soku z cytryny"],
    ["jogurt", "2 łyżki jogurtu naturalnego"],
    ["proszek", "1 czubata łyżeczka proszku do pieczenia"],
  ];

  it.each(declensionPairs)(
    "searching the nominative form %s finds a recipe storing the declined form",
    async (searchForm, storedForm) => {
      const uniqueStoredForm = `${storedForm} #${crypto.randomUUID().slice(0, 8)}`;
      const recipe = await createRecipeWithIngredient(`Recipe for ${searchForm}`, uniqueStoredForm);

      const results = await searchByIngredient(searchForm);

      expect(results.map((r) => r.id)).toContain(recipe.id);
    },
  );

  it.each(declensionPairs)(
    "searching the declined form of %s also finds a recipe storing the same declined form (trigger populated search_key on insert)",
    async (_searchForm, storedForm) => {
      const uniqueStoredForm = `${storedForm} #${crypto.randomUUID().slice(0, 8)}`;
      const recipe = await createRecipeWithIngredient(`Recipe for ${storedForm}`, uniqueStoredForm);

      const results = await searchByIngredient(uniqueStoredForm);

      expect(results.map((r) => r.id)).toContain(recipe.id);
    },
  );

  it("does not over-match on an unrelated short word", async () => {
    const marker = crypto.randomUUID().slice(0, 8);
    await createRecipeWithIngredient(`Sól recipe ${marker}`, `łyżeczka soli ${marker}`);

    const results = await searchByIngredient(`ryz-unrelated-${marker}`);

    expect(results).toHaveLength(0);
  });

  it("combines a search query with the type filter", async () => {
    const marker = crypto.randomUUID().slice(0, 8);
    const soupRecipe = await createRecipeWithIngredient(`Soup ${marker}`, `170 g cukru ${marker}`, "soup");
    await createRecipeWithIngredient(`Dessert ${marker}`, `170 g cukru ${marker}`, "dessert");

    const results = await searchByIngredient(`cukier ${marker}`, "soup");

    expect(results.map((r) => r.id)).toEqual([soupRecipe.id]);
  });

  it("returns an empty set, not an error, for a non-matching query", async () => {
    const results = await searchByIngredient(`nonexistent-ingredient-${crypto.randomUUID()}`);

    expect(results).toEqual([]);
  });
});
