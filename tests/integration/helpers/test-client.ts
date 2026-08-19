import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.test.local.example to .env.test.local and fill in the ` +
        `SnapRecipe (dev) project's URL and anon key from the Supabase dashboard.`,
    );
  }
  return value;
}

export interface TestUser {
  client: SupabaseClient<Database>;
  userId: string;
  email: string;
}

/**
 * Creates a fresh, uniquely-named, authenticated test user against the SnapRecipe dev project via
 * plain signUp() — its auth config allows sign-up without email confirmation, so no service-role
 * key or email step is needed. Users are never cleaned up; the `integration-test-` email prefix
 * keeps them identifiable in the dev project if cleanup is ever wanted.
 */
export async function createTestUser(): Promise<TestUser> {
  const client = createAnonClient();
  const email = `integration-test-${crypto.randomUUID()}@example.com`;
  const password = crypto.randomUUID();

  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.user) {
    throw new Error(`Failed to create test user: ${error?.message ?? "no user returned"}`);
  }

  return { client, userId: data.user.id, email };
}

/**
 * A client with no signed-in session, scoped to the `anon` role rather than `authenticated`.
 * Used as a non-invasive regression sanity check: `recipes`/`recipe_ingredients`/`storage.objects`
 * policies are all scoped `to authenticated`, so an anon client has no grant on them at all —
 * exercising the same "should see nothing" assertion path a broken/removed policy would also hit,
 * without ever mutating a real policy to prove it.
 */
export function createAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(requireEnv("SUPABASE_TEST_URL"), requireEnv("SUPABASE_TEST_ANON_KEY"));
}
