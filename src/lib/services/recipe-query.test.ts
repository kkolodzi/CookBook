import { describe, expect, it, vi } from "vitest";
import { getRecipeDetail, listRecipes } from "./recipe-query";

interface QueryResult {
  data: unknown[] | null;
  error: unknown;
}

function makeQueryBuilder(result: QueryResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    then: (resolve: (value: QueryResult) => void) => {
      resolve(result);
    },
  };
  return builder;
}

function makeSupabaseClient(options: {
  queryResult: QueryResult;
  signedUrlsResult?: { data: { path: string; signedUrl?: string; error?: string | null }[] | null; error: unknown };
}) {
  const builder = makeQueryBuilder(options.queryResult);
  const from = vi.fn(() => builder);
  const createSignedUrls = vi.fn().mockResolvedValue(options.signedUrlsResult ?? { data: [], error: null });
  const storage = { from: vi.fn().mockReturnValue({ createSignedUrls }) };
  return { from, storage, builder, createSignedUrls };
}

const sampleRow = {
  id: "recipe-1",
  name: "Zupa pomidorowa",
  type: "soup",
  photo_path: "user-1/recipe-1.jpg",
  created_at: "2026-08-16T00:00:00.000Z",
};

describe("listRecipes", () => {
  it("excludes soft-deleted recipes and scopes to the owning user", async () => {
    const client = makeSupabaseClient({ queryResult: { data: [], error: null } });

    await listRecipes(client as never, "user-1", {});

    expect(client.builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(client.builder.is).toHaveBeenCalledWith("deleted_at", null);
    expect(client.builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(client.builder.limit).toHaveBeenCalledWith(200);
    expect(client.builder.ilike).not.toHaveBeenCalled();
  });

  it("filters by ingredient via an embedded recipe_ingredients inner-join ilike", async () => {
    const client = makeSupabaseClient({ queryResult: { data: [], error: null } });

    await listRecipes(client as never, "user-1", { q: " marchewka " });

    expect(client.builder.select).toHaveBeenCalledWith(expect.stringContaining("recipe_ingredients!inner"));
    expect(client.builder.ilike).toHaveBeenCalledWith("recipe_ingredients.name", "%marchewka%");
  });

  it("escapes ilike wildcard characters in the search query", async () => {
    const client = makeSupabaseClient({ queryResult: { data: [], error: null } });

    await listRecipes(client as never, "user-1", { q: "50%_off" });

    expect(client.builder.ilike).toHaveBeenCalledWith("recipe_ingredients.name", "%50\\%\\_off%");
  });

  it("filters by type", async () => {
    const client = makeSupabaseClient({ queryResult: { data: [], error: null } });

    await listRecipes(client as never, "user-1", { type: "soup" });

    expect(client.builder.eq).toHaveBeenCalledWith("type", "soup");
    expect(client.builder.ilike).not.toHaveBeenCalled();
  });

  it("returns an empty list on a query error", async () => {
    const client = makeSupabaseClient({ queryResult: { data: null, error: { message: "boom" } } });

    const result = await listRecipes(client as never, "user-1", {});

    expect(result).toEqual([]);
  });

  it("maps rows to summaries with signed photo URLs, batching a single createSignedUrls call", async () => {
    const client = makeSupabaseClient({
      queryResult: { data: [sampleRow], error: null },
      signedUrlsResult: {
        data: [{ path: sampleRow.photo_path, signedUrl: "https://signed.example/recipe-1.jpg", error: null }],
        error: null,
      },
    });

    const result = await listRecipes(client as never, "user-1", {});

    expect(client.createSignedUrls).toHaveBeenCalledOnce();
    expect(client.createSignedUrls).toHaveBeenCalledWith([sampleRow.photo_path], 3600);
    expect(result).toEqual([
      {
        id: "recipe-1",
        name: "Zupa pomidorowa",
        type: "soup",
        createdAt: "2026-08-16T00:00:00.000Z",
        photoUrl: "https://signed.example/recipe-1.jpg",
      },
    ]);
  });

  it("degrades a single failed signed URL to null instead of failing the whole list", async () => {
    const client = makeSupabaseClient({
      queryResult: { data: [sampleRow], error: null },
      signedUrlsResult: { data: [{ path: sampleRow.photo_path, error: "not found" }], error: null },
    });

    const result = await listRecipes(client as never, "user-1", {});

    expect(result[0].photoUrl).toBeNull();
  });

  it("skips signing entirely when there are no rows", async () => {
    const client = makeSupabaseClient({ queryResult: { data: [], error: null } });

    await listRecipes(client as never, "user-1", {});

    expect(client.createSignedUrls).not.toHaveBeenCalled();
  });
});

interface DetailQueryResult {
  data: unknown;
  error: unknown;
}

function makeDetailClient(options: {
  recipeResult: DetailQueryResult;
  ingredientsResult?: DetailQueryResult;
  signedUrlResult?: { data: { signedUrl: string } | null; error: unknown };
}) {
  const recipeChain = {
    select: vi.fn(() => recipeChain),
    eq: vi.fn(() => recipeChain),
    is: vi.fn(() => recipeChain),
    maybeSingle: vi.fn().mockResolvedValue(options.recipeResult),
  };
  const ingredientsChain = {
    select: vi.fn(() => ingredientsChain),
    eq: vi.fn(() => ingredientsChain),
    order: vi.fn().mockResolvedValue(options.ingredientsResult ?? { data: [], error: null }),
  };
  const from = vi.fn((table: string) => (table === "recipes" ? recipeChain : ingredientsChain));
  const createSignedUrl = vi
    .fn()
    .mockResolvedValue(
      options.signedUrlResult ?? { data: { signedUrl: "https://signed.example/recipe-1.jpg" }, error: null },
    );
  const storage = { from: vi.fn().mockReturnValue({ createSignedUrl }) };
  return { from, storage, recipeChain, ingredientsChain, createSignedUrl };
}

const sampleRecipeRow = {
  id: "recipe-1",
  name: "Zupa pomidorowa",
  type: "soup",
  photo_path: "user-1/recipe-1.jpg",
  created_at: "2026-08-16T00:00:00.000Z",
  instructions: "Ugotuj pomidory z cebulą, zmiksuj i dopraw.",
};

describe("getRecipeDetail", () => {
  it("scopes by id, owning user, and excludes soft-deleted rows", async () => {
    const client = makeDetailClient({ recipeResult: { data: sampleRecipeRow, error: null } });

    await getRecipeDetail(client as never, "user-1", "recipe-1");

    expect(client.recipeChain.eq).toHaveBeenCalledWith("id", "recipe-1");
    expect(client.recipeChain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(client.recipeChain.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("returns null when no matching recipe is found", async () => {
    const client = makeDetailClient({ recipeResult: { data: null, error: null } });

    const result = await getRecipeDetail(client as never, "user-1", "missing");

    expect(result).toBeNull();
  });

  it("returns null on a query error", async () => {
    const client = makeDetailClient({ recipeResult: { data: null, error: { message: "boom" } } });

    const result = await getRecipeDetail(client as never, "user-1", "recipe-1");

    expect(result).toBeNull();
  });

  it("returns the full ingredient list ordered by position, with a signed photo URL", async () => {
    const client = makeDetailClient({
      recipeResult: { data: sampleRecipeRow, error: null },
      ingredientsResult: {
        data: [
          { id: "ing-1", name: "pomidory", position: 0 },
          { id: "ing-2", name: "cebula", position: 1 },
        ],
        error: null,
      },
    });

    const result = await getRecipeDetail(client as never, "user-1", "recipe-1");

    expect(client.ingredientsChain.order).toHaveBeenCalledWith("position", { ascending: true });
    expect(result).toEqual({
      id: "recipe-1",
      name: "Zupa pomidorowa",
      type: "soup",
      createdAt: "2026-08-16T00:00:00.000Z",
      photoUrl: "https://signed.example/recipe-1.jpg",
      ingredients: [
        { id: "ing-1", name: "pomidory", position: 0 },
        { id: "ing-2", name: "cebula", position: 1 },
      ],
      instructions: "Ugotuj pomidory z cebulą, zmiksuj i dopraw.",
    });
  });

  it("degrades to a null photoUrl instead of failing when signing errors", async () => {
    const client = makeDetailClient({
      recipeResult: { data: sampleRecipeRow, error: null },
      signedUrlResult: { data: null, error: { message: "not found" } },
    });

    const result = await getRecipeDetail(client as never, "user-1", "recipe-1");

    expect(result?.photoUrl).toBeNull();
  });
});
