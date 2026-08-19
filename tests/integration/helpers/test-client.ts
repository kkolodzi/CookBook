import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.test.local.example to .env.test.local, run \`npx supabase status\` ` +
        `(after \`npx supabase start\`) and fill in the real value.`,
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
  const url = process.env.SUPABASE_TEST_URL ?? "http://127.0.0.1:54321";
  const anonKey = requireEnv("SUPABASE_TEST_ANON_KEY");

  const client = createClient<Database>(url, anonKey);
  const email = `integration-test-${crypto.randomUUID()}@example.com`;
  const password = crypto.randomUUID();

  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.user) {
    throw new Error(`Failed to create test user: ${error?.message ?? "no user returned"}`);
  }

  return { client, userId: data.user.id, email };
}
