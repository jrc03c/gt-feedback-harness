import { test } from "node:test"
import assert from "node:assert/strict"
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  OAUTH_PROVIDER,
  isConfigured,
} from "../../src/config.js"

test("config exposes the Supabase project and reports whether it is set", () => {
  assert.equal(typeof SUPABASE_URL, "string")
  assert.equal(typeof SUPABASE_ANON_KEY, "string")
  assert.equal(OAUTH_PROVIDER, "google")
  assert.equal(
    isConfigured(),
    SUPABASE_URL.startsWith("https://") &&
      !SUPABASE_URL.includes("REPLACE") &&
      SUPABASE_ANON_KEY.length > 20 &&
      SUPABASE_ANON_KEY !== "REPLACE",
  )
  if (isConfigured())
    assert.match(SUPABASE_URL, /^https:\/\/[a-z]+\.supabase\.co$/)
})
