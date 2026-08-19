import { describe, it, expect } from "vitest";
import { createTestUser } from "./helpers/test-client";

describe("integration test harness", () => {
  it("lets an authenticated user upload a photo, save a recipe referencing it, and read it back", async () => {
    const { client, userId } = await createTestUser();

    const photoPath = `${userId}/${crypto.randomUUID()}.txt`;
    const { error: uploadError } = await client.storage
      .from("recipe-photos")
      .upload(photoPath, new Uint8Array([1, 2, 3, 4]), { contentType: "text/plain" });
    if (uploadError) {
      throw new Error(`Smoke-test photo upload failed: ${uploadError.message}`);
    }

    const { data: inserted, error: insertError } = await client
      .from("recipes")
      .insert({ user_id: userId, name: "Smoke Test Recipe", type: "other", photo_path: photoPath })
      .select()
      .single();
    if (insertError) {
      throw new Error(`Smoke-test recipe insert failed: ${insertError.message}`);
    }
    expect(inserted.name).toBe("Smoke Test Recipe");

    const { data: fetched, error: selectError } = await client
      .from("recipes")
      .select("id, name, user_id, photo_path")
      .eq("id", inserted.id)
      .single();

    expect(selectError).toBeNull();
    expect(fetched).toMatchObject({ name: "Smoke Test Recipe", user_id: userId, photo_path: photoPath });
  });
});
