import { test } from "node:test"
import assert from "node:assert/strict"
import { parseEnv, credentials } from "../../../src/cli/env.js"

test("parseEnv reads plain, quoted, and exported lines and skips comments", () => {
  const parsed = parseEnv(
    [
      "# comment",
      "",
      "PLAIN=value with spaces ",
      'DOUBLE="a=b"',
      "SINGLE='x y'",
      'export EXPORTED="e"',
      "BACKTICK=pa`ss",
      "not a line",
    ].join("\n"),
  )
  assert.deepEqual(parsed, {
    PLAIN: "value with spaces",
    DOUBLE: "a=b",
    SINGLE: "x y",
    EXPORTED: "e",
    BACKTICK: "pa`ss",
  })
})

test("credentials prefer the process environment over the .env file", () => {
  const env = { GT_FEEDBACK_HARNESS_EMAIL: "env@example.com" }
  const file = {
    GT_FEEDBACK_HARNESS_EMAIL: "file@example.com",
    GT_FEEDBACK_HARNESS_PASSWORD: "filepass",
    GT_EMAIL: "gt@example.com",
    GT_PASSWORD: "gtpass",
  }
  assert.deepEqual(credentials(env, file), {
    harness: { email: "env@example.com", password: "filepass" },
    guidedtrack: { email: "gt@example.com", password: "gtpass" },
  })
})

test("credentials are null when a pair is incomplete", () => {
  assert.deepEqual(credentials({ GT_EMAIL: "x" }, {}), {
    harness: null,
    guidedtrack: null,
  })
})
