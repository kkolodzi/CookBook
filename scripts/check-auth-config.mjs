#!/usr/bin/env node
// Fails (exit 1) if the target's /auth/signin page shows the "Supabase not configured"
// banner (src/lib/config-status.ts), so a missing/placeholder credential regression is
// caught with one command instead of manually hunting for the banner.

const baseUrl = process.argv[2] ?? "http://localhost:4321";
const NOT_CONFIGURED_MESSAGE = "Supabase nie jest skonfigurowany";

const url = new URL("/auth/signin", baseUrl);

let response;
try {
  response = await fetch(url);
} catch (error) {
  console.error(`✗ Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!response.ok) {
  console.error(`✗ ${url} returned HTTP ${response.status}, not treating as a valid check.`);
  process.exit(1);
}

const body = await response.text();

if (body.includes(NOT_CONFIGURED_MESSAGE)) {
  console.error(`✗ ${url} shows the "not configured" banner — Supabase credentials are missing or invalid.`);
  process.exit(1);
}

console.log(`✓ ${url} — Supabase is configured (no "not configured" banner).`);
