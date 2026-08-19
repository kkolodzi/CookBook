import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(path.resolve(dirname, ".env.test.local"));
} catch {
  // .env.test.local is optional — CI or a developer's own shell may export
  // SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY directly instead.
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 15000,
  },
});
