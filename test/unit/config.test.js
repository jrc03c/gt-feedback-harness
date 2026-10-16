import { test } from "node:test"
import assert from "node:assert/strict"
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  OAUTH_PROVIDER,
  isConfigured,
  isConfiguredValue,
} from "../../src/config.js"

const url = "https://abcdefghij.supabase.co"

test("config holds the real project with a publishable key", () => {
  assert.equal(OAUTH_PROVIDER, "github")
  assert.match(SUPABASE_URL, /^https:\/\/[a-z]+\.supabase\.co$/)
  assert.match(SUPABASE_ANON_KEY, /^sb_publishable_/)
  assert.equal(isConfigured(), true)
})

test("a publishable key on a supabase.co URL is configured", () => {
  assert.equal(isConfiguredValue(url, "sb_publishable_abc123-XYZ_9"), true)
})

test("a secret key is refused even on a valid URL", () => {
  assert.equal(isConfiguredValue(url, "sb_secret_abc123-XYZ_9"), false)
})

test("placeholders, legacy keys, and other URLs are not configured", () => {
  assert.equal(
    isConfiguredValue("https://REPLACE.supabase.co", "REPLACE"),
    false,
  )
  assert.equal(isConfiguredValue(url, "REPLACE"), false)
  assert.equal(
    isConfiguredValue(url, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.x.y"),
    false,
  )
  assert.equal(
    isConfiguredValue("http://abcdefghij.supabase.co", "sb_publishable_a"),
    false,
  )
  assert.equal(
    isConfiguredValue("https://abcdefghij.supabase.co/", "sb_publishable_a"),
    false,
  )
  assert.equal(
    isConfiguredValue("https://evil.example.com", "sb_publishable_a"),
    false,
  )
  assert.equal(isConfiguredValue(undefined, undefined), false)
})
