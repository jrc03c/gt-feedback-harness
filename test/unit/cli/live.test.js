// Live checks against GuidedTrack and the real Supabase project. Each skips
// unless its credentials are in the environment, so CI never needs them.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createClient } from "@supabase/supabase-js"
import { credentials } from "../../../src/cli/env.js"
import { createGuidedTrack } from "../../../src/cli/guidedtrack.js"
import { createStore } from "../../../src/store.js"
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../../../src/config.js"

const { harness, guidedtrack } = credentials(process.env, {})

test(
  "GuidedTrack finds a program by name and by key and lists its pages",
  { skip: guidedtrack ? false : "GT_EMAIL/GT_PASSWORD not set" },
  async () => {
    const gt = createGuidedTrack(guidedtrack)
    const byName = await gt.findProgram("What Is Your Favorite Color?")
    assert.ok(byName, "program found by name")
    assert.equal(byName.key, "xz83kzr")
    const byKey = await gt.findProgram("xz83kzr")
    assert.equal(byKey.id, byName.id)
    const pages = await gt.listPages(byName.id)
    assert.ok(
      pages.some(p =>
        p.url.startsWith("https://programs.clearerthinking.org/"),
      ),
    )
    assert.equal(await gt.findProgram("no such program " + Date.now()), null)
  },
)

test(
  "the real project accepts the script password and lists programs",
  { skip: harness ? false : "GT_FEEDBACK_HARNESS_EMAIL/PASSWORD not set" },
  async () => {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const store = createStore({
      url: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      client,
    })
    const user = await store.signInWithPassword(harness.email, harness.password)
    assert.equal(user.is_anonymous, false)
    assert.ok(Array.isArray(await store.listPrograms()))
  },
)
