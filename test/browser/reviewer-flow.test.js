import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

async function open(page, baseUrl, shareId, mode) {
  await page.goto(`${baseUrl}/test/fixtures/reviewer-flow.html`)
  await page.waitForFunction(() => window.fixtureReady === true)
  await page.evaluate(({ shareId, mode }) => window.run(shareId, mode), {
    shareId,
    mode,
  })
}

test("a valid link signs in anonymously, creates a session, and stores sent items", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl, "SHARESHARESHARESHARESHAR", "test")
    await page.waitForSelector(".program_container .main p")
    const session = await page.evaluate(() => window.store.state.sessions[0])
    assert.equal(session.program_id, "p-1")
    assert.equal(session.mode, "test")
    assert.equal(session.reviewer_uid, "anon-1")
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem("harness:session:SHARESHARESHARESHARESHAR"),
      ),
      session.id,
    )

    await page.fill(".harness-name input", "Alice")
    await page.press(".harness-name input", "Tab")
    await page.click(".harness-feedback-button")
    await page.waitForSelector(".harness-modal")
    await page.fill(".harness-text", "Button is misaligned")
    await page.click('[data-action="send"]')
    await page.waitForSelector(".harness-modal", { state: "detached" })

    const stored = await page.evaluate(() => ({
      items: window.store.state.items,
      sessions: window.store.state.sessions,
      screenshots: Array.from(window.store.state.screenshots.keys()),
    }))
    assert.equal(stored.items.length, 1)
    assert.equal(stored.items[0].text, "Button is misaligned")
    assert.equal(stored.items[0].context.runId, "run-123")
    assert.equal(stored.items[0].screenshot_path, stored.screenshots[0])
    assert.equal(stored.sessions[0].reviewer_name, "Alice")
  })
})

test("the heartbeat updates last_seen_at", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl, "SHARESHARESHARESHARESHAR", "run")
    await page.waitForSelector(".program_container .main p")
    const before = await page.evaluate(
      () => window.store.state.sessions[0].last_seen_at,
    )
    await page.waitForFunction(
      b => window.store.state.sessions[0].last_seen_at !== b,
      before,
      { timeout: 5000 },
    )
    assert.ok(
      await page.evaluate(
        () =>
          window.store.calls.filter(c => c.startsWith("touchSession")).length >=
          1,
      ),
    )
  })
})

test("a reload reuses the session instead of creating a second one", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl, "SHARESHARESHARESHARESHAR", "run")
    await page.waitForSelector(".program_container .main p")
    await page.evaluate(() => {
      window.harness.runReviewer({
        root: document.getElementById("app"),
        route: {
          screen: "reviewer",
          shareId: "SHARESHARESHARESHARESHAR",
          mode: "run",
        },
        store: window.store,
        assetBase: "/test/fixtures/gt-stub",
      })
    })
    await page.waitForSelector(".program_container .main p")
    assert.equal(
      await page.evaluate(() => window.store.state.sessions.length),
      1,
    )
  })
})

test("an unknown link shows the invalid-link banner and no program", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl, "NOPENOPENOPENOPENOPENOPE", "test")
    await page.waitForSelector(".harness-banner")
    assert.match(
      await page.locator(".harness-banner h2").innerText(),
      /isn't valid/,
    )
    assert.equal(await page.locator(".program_container").count(), 0)
    assert.equal(
      await page.evaluate(() => window.store.state.sessions.length),
      0,
    )
  })
})

test("a stale stored session id is replaced on the first send", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/reviewer-flow.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    await page.evaluate(() => {
      sessionStorage.setItem(
        "harness:session:SHARESHARESHARESHARESHAR",
        "stale-id",
      )
      return window.run("SHARESHARESHARESHARESHAR", "test")
    })
    await page.waitForSelector(".program_container .main p")
    await page.click(".harness-feedback-button")
    await page.waitForSelector(".harness-modal")
    await page.fill(".harness-text", "After stale")
    await page.click('[data-action="send"]')
    await page.waitForSelector(".harness-modal", { state: "detached" })
    const result = await page.evaluate(() => ({
      sessions: window.store.state.sessions,
      items: window.store.state.items,
      stored: sessionStorage.getItem(
        "harness:session:SHARESHARESHARESHARESHAR",
      ),
    }))
    assert.equal(result.sessions.length, 1)
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].session_id, result.sessions[0].id)
    assert.equal(result.stored, result.sessions[0].id)
  })
})

test("a backend failure shows the unavailable banner", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/reviewer-flow.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    await page.evaluate(() => {
      window.store.resolveShare = async () => {
        throw new Error("offline")
      }
      return window.run("SHARESHARESHARESHARESHAR", "test")
    })
    await page.waitForSelector(".harness-banner")
    const text = await page.locator(".harness-banner").innerText()
    assert.match(text, /unavailable/)
    assert.match(text, /offline/)
    assert.equal(await page.locator(".program_container").count(), 0)
  })
})
