import { describe, it, expect } from "vitest";
import { createTestUser } from "./helpers/test-client";

describe("photo_path ownership trigger", () => {
  it("rejects a direct insert whose photo_path references another user's storage object", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    const bPhotoPath = `${userB.userId}/${crypto.randomUUID()}.txt`;
    const { error: uploadError } = await userB.client.storage
      .from("recipe-photos")
      .upload(bPhotoPath, new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
    if (uploadError) {
      throw new Error(`Setup upload (as B) failed: ${uploadError.message}`);
    }

    const { data, error } = await userA.client
      .from("recipes")
      .insert({ user_id: userA.userId, name: "A pretending to own B's photo", type: "other", photo_path: bPhotoPath })
      .select();

    expect(data).toBeNull();
    expect(error?.message).toContain(
      "photo_path must reference a storage object in recipe-photos owned by the same user",
    );
  });

  it("still allows the legitimate same-owner insert — the real POST /api/recipes flow", async () => {
    const userA = await createTestUser();

    const photoPath = `${userA.userId}/${crypto.randomUUID()}.txt`;
    const { error: uploadError } = await userA.client.storage
      .from("recipe-photos")
      .upload(photoPath, new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
    if (uploadError) {
      throw new Error(`Setup upload failed: ${uploadError.message}`);
    }

    const { data, error } = await userA.client
      .from("recipes")
      .insert({ user_id: userA.userId, name: "A's own legitimate recipe", type: "other", photo_path: photoPath })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data.photo_path).toBe(photoPath);
  });
});
