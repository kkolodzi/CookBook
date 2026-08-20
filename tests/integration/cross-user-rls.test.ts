import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, createAnonClient, type TestUser } from "./helpers/test-client";

describe("cross-user RLS isolation", () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
  });

  async function createRecipeAs(user: TestUser, name: string) {
    const photoPath = `${user.userId}/${crypto.randomUUID()}.txt`;
    const { error: uploadError } = await user.client.storage
      .from("recipe-photos")
      .upload(photoPath, new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
    if (uploadError) {
      throw new Error(`Setup upload failed: ${uploadError.message}`);
    }

    const { data, error } = await user.client
      .from("recipes")
      .insert({ user_id: user.userId, name, type: "other", photo_path: photoPath })
      .select()
      .single();
    if (error) {
      throw new Error(`Setup recipe insert failed: ${error.message}`);
    }
    return { recipeId: data.id, photoPath };
  }

  describe("recipes table", () => {
    it("denies a cross-user select", async () => {
      const { recipeId } = await createRecipeAs(userA, "A's recipe — select denial");
      const { data, error } = await userB.client.from("recipes").select().eq("id", recipeId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("allows the owner to select their own recipe", async () => {
      const { recipeId } = await createRecipeAs(userA, "A's recipe — owner select");
      const { data, error } = await userA.client.from("recipes").select().eq("id", recipeId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("denies a cross-user update", async () => {
      const { recipeId } = await createRecipeAs(userA, "A's recipe — update denial");
      const { data, error } = await userB.client.from("recipes").update({ name: "hacked" }).eq("id", recipeId).select();
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: stillOriginal } = await userA.client.from("recipes").select("name").eq("id", recipeId).single();
      expect(stillOriginal?.name).toBe("A's recipe — update denial");
    });

    it("denies a cross-user delete", async () => {
      const { recipeId } = await createRecipeAs(userA, "A's recipe — delete denial");
      const { data, error } = await userB.client.from("recipes").delete().eq("id", recipeId).select();
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: stillThere } = await userA.client.from("recipes").select("id").eq("id", recipeId).single();
      expect(stillThere?.id).toBe(recipeId);
    });

    it("denies inserting a recipe row under another user's id", async () => {
      const photoPath = `${userB.userId}/${crypto.randomUUID()}.txt`;
      const { error: uploadError } = await userB.client.storage
        .from("recipe-photos")
        .upload(photoPath, new Uint8Array([1]), { contentType: "text/plain" });
      if (uploadError) {
        throw new Error(`Setup upload failed: ${uploadError.message}`);
      }

      const { data, error } = await userA.client
        .from("recipes")
        .insert({ user_id: userB.userId, name: "spoofed via insert", type: "other", photo_path: photoPath })
        .select();
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });
  });

  describe("recipe_ingredients table", () => {
    it("denies a cross-user select of ingredients", async () => {
      const { recipeId } = await createRecipeAs(userA, "A's recipe — ingredients select denial");
      const { error: setupError } = await userA.client
        .from("recipe_ingredients")
        .insert({ recipe_id: recipeId, name: "Flour", position: 0 });
      if (setupError) {
        throw new Error(`Setup ingredient insert failed: ${setupError.message}`);
      }

      const { data, error } = await userB.client.from("recipe_ingredients").select().eq("recipe_id", recipeId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("denies inserting an ingredient into another user's recipe", async () => {
      const { recipeId } = await createRecipeAs(userA, "A's recipe — ingredient insert denial");
      const { data, error } = await userB.client
        .from("recipe_ingredients")
        .insert({ recipe_id: recipeId, name: "Sugar", position: 0 })
        .select();
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it("allows the owner to select their own ingredients", async () => {
      const { recipeId } = await createRecipeAs(userA, "A's recipe — ingredients owner select");
      const { error: setupError } = await userA.client
        .from("recipe_ingredients")
        .insert({ recipe_id: recipeId, name: "Flour", position: 0 });
      if (setupError) {
        throw new Error(`Setup ingredient insert failed: ${setupError.message}`);
      }

      const { data, error } = await userA.client.from("recipe_ingredients").select().eq("recipe_id", recipeId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("denies a cross-user update of an ingredient", async () => {
      const { recipeId } = await createRecipeAs(userA, "A's recipe — ingredient update denial");
      const { data: ingredient, error: setupError } = await userA.client
        .from("recipe_ingredients")
        .insert({ recipe_id: recipeId, name: "Flour", position: 0 })
        .select()
        .single();
      if (setupError) {
        throw new Error(`Setup ingredient insert failed: ${setupError.message}`);
      }

      const { data, error } = await userB.client
        .from("recipe_ingredients")
        .update({ name: "hacked" })
        .eq("id", ingredient.id)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: stillOriginal } = await userA.client
        .from("recipe_ingredients")
        .select("name")
        .eq("id", ingredient.id)
        .single();
      expect(stillOriginal?.name).toBe("Flour");
    });

    it("denies a cross-user delete of an ingredient", async () => {
      const { recipeId } = await createRecipeAs(userA, "A's recipe — ingredient delete denial");
      const { data: ingredient, error: setupError } = await userA.client
        .from("recipe_ingredients")
        .insert({ recipe_id: recipeId, name: "Flour", position: 0 })
        .select()
        .single();
      if (setupError) {
        throw new Error(`Setup ingredient insert failed: ${setupError.message}`);
      }

      const { data, error } = await userB.client.from("recipe_ingredients").delete().eq("id", ingredient.id).select();
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: stillThere } = await userA.client
        .from("recipe_ingredients")
        .select("id")
        .eq("id", ingredient.id)
        .single();
      expect(stillThere?.id).toBe(ingredient.id);
    });
  });

  describe("storage.objects (recipe-photos bucket)", () => {
    it("denies a cross-user download", async () => {
      const { photoPath } = await createRecipeAs(userA, "A's recipe — storage download denial");
      const { data, error } = await userB.client.storage.from("recipe-photos").download(photoPath);
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it("allows the owner to download their own photo", async () => {
      const { photoPath } = await createRecipeAs(userA, "A's recipe — storage owner download");
      const { data, error } = await userA.client.storage.from("recipe-photos").download(photoPath);
      expect(error).toBeNull();
      expect(data).not.toBeNull();
    });

    it("denies a cross-user delete of the storage object", async () => {
      const { photoPath } = await createRecipeAs(userA, "A's recipe — storage delete denial");
      await userB.client.storage.from("recipe-photos").remove([photoPath]);

      // Storage's remove() can resolve without an error even when RLS filters out every
      // targeted path (nothing visible to delete) — the real proof of denial is that the
      // object is still there afterward, downloadable by its actual owner.
      const { data: stillThere, error: stillThereError } = await userA.client.storage
        .from("recipe-photos")
        .download(photoPath);
      expect(stillThereError).toBeNull();
      expect(stillThere).not.toBeNull();
    });
  });

  describe("edit_recipe RPC", () => {
    it("rejects another user's recipe_id instead of erroring or applying the edit", async () => {
      const { recipeId } = await createRecipeAs(userA, "A's recipe — RPC ownership guard");
      const { data, error } = await userB.client.rpc("edit_recipe", {
        p_recipe_id: recipeId,
        p_name: "hacked via rpc",
        p_type: "other",
        p_ingredients: [],
      });
      expect(error).toBeNull();
      expect(data).toBe(false);

      const { data: stillOriginal } = await userA.client.from("recipes").select("name").eq("id", recipeId).single();
      expect(stillOriginal?.name).toBe("A's recipe — RPC ownership guard");
    });
  });

  describe("non-invasive regression sanity check", () => {
    it("an unauthenticated client is denied on recipes — proves this suite's core assertion can fail", async () => {
      // See createAnonClient()'s doc comment: this exercises the same "denied" assertion path a
      // broken/removed RLS policy would hit, without mutating any real policy. The `anon` role
      // has no table-level grant on `recipes` at all (confirmed live: error code 42501,
      // "permission denied for table recipes") — a coarser denial than RLS's usual silent
      // empty-result filtering, but still proof this suite's assertions are capable of failing.
      const { recipeId } = await createRecipeAs(userA, "A's recipe — anon sanity check");
      const anonClient = createAnonClient();
      const { data, error } = await anonClient.from("recipes").select().eq("id", recipeId);
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });
  });
});
