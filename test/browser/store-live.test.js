import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

const url = process.env.HARNESS_SUPABASE_URL
const anonKey = process.env.HARNESS_SUPABASE_ANON_KEY

test(
  "the real project accepts anonymous reviewers and enforces the share policy",
  { skip: !url || !anonKey ? "HARNESS_SUPABASE_URL/ANON_KEY not set" : false },
  async () => {
    await withPage(async ({ page, baseUrl }) => {
      await page.goto(`${baseUrl}/test/fixtures/smoke.html`)
      await page.waitForFunction(() => window.harness !== undefined)
      const result = await page.evaluate(
        async ({ url, anonKey }) => {
          const store = window.harness.createStore({ url, anonKey })
          const user = await store.signInAnonymously()
          const unknown = await store.resolveShare("ZZZZZZZZZZZZZZZZZZZZZZZZ")
          let forged = "allowed"
          try {
            await store.createSession({
              programId: "00000000-0000-4000-8000-000000000000",
              shareId: "ZZZZZZZZZZZZZZZZZZZZZZZZ",
              mode: "test",
            })
          } catch (error) {
            forged = error.code || error.message
          }
          return { anonymous: user.is_anonymous === true, unknown, forged }
        },
        { url, anonKey },
      )
      assert.equal(result.anonymous, true)
      assert.equal(result.unknown, null)
      assert.notEqual(result.forged, "allowed")
    })
  },
)
