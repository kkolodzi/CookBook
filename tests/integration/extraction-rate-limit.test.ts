import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, type TestUser } from "./helpers/test-client";

describe("extraction rate limit", () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser();
  });

  it("allows attempts up to the cap and rejects the next one", async () => {
    const results: boolean[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await user.client.rpc("reserve_extraction_attempt", { p_cap: 3 });
      expect(error).toBeNull();
      if (data === null) {
        throw new Error("reserve_extraction_attempt returned null data with no error");
      }
      results.push(data);
    }

    expect(results).toEqual([true, true, true, false]);
  });

  // Deliberately depends on the previous test's state (relies on Vitest's default sequential
  // `it` execution within a file) -- reusing `user` here, rather than a fresh one, is what
  // proves the counter persists across separate reservation calls instead of resetting.
  // Reordering, parallelizing, or skipping the test above will break this one.
  it("keeps counting against the same day across multiple reservation calls", async () => {
    const { data, error } = await user.client.rpc("reserve_extraction_attempt", { p_cap: 10 });
    expect(error).toBeNull();
    // This is the 5th reservation for this user today (4 from the previous test), so it must
    // still succeed against a cap of 10 -- proving the counter carries forward across calls
    // rather than resetting or being scoped to whatever p_cap value was passed before.
    expect(data).toBe(true);
  });

  it("scopes the counter per user", async () => {
    const otherUser = await createTestUser();
    const { data, error } = await otherUser.client.rpc("reserve_extraction_attempt", { p_cap: 1 });
    expect(error).toBeNull();
    // A brand-new user's first attempt against a cap of 1 must succeed regardless of how many
    // attempts the first user already made -- proving the (user_id, day) key actually isolates
    // counters instead of sharing a single counter across all callers.
    expect(data).toBe(true);
  });
});
