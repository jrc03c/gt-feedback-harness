import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

async function open(page, baseUrl) {
  await page.goto(`${baseUrl}/test/fixtures/developer.html`)
  await page.waitForFunction(() => window.fixtureReady === true)
  await page.evaluate(() => window.mount())
}

test("signed out shows the sign-in prompt and signing in lists programs with counts", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.waitForSelector(".harness-signin")
    assert.equal(await page.locator(".harness-program-card").count(), 0)
    assert.equal(
      await page.locator(".harness-signin button").innerText(),
      "Sign in with GitHub",
    )
    await page.click(".harness-signin button")
    await page.waitForSelector(".harness-program-card")
    assert.equal(
      await page.evaluate(() =>
        window.store.calls.find(c => c.startsWith("signInWithProvider")),
      ),
      "signInWithProvider:github:https://example.test/harness/?dev",
    )
    assert.match(
      await page.locator(".harness-program-card h3").innerText(),
      /Demo/,
    )
    assert.match(
      await page.locator(".harness-program-card .harness-counts").innerText(),
      /1 session.*1 unresolved/s,
    )
    assert.match(
      await page.locator(".harness-setup-url").innerText(),
      /^https:\/\/example\.test\/harness\/$/,
    )
  })
})

test("the card shows run and test links built from the share id", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click(".harness-signin button")
    await page.waitForSelector(".harness-program-card")
    const links = await page
      .locator(".harness-program-card .harness-link input")
      .evaluateAll(els => els.map(e => e.value))
    assert.deepEqual(links, [
      "https://example.test/harness/?r=SHARESHARESHARESHARESHAR&mode=run",
      "https://example.test/harness/?r=SHARESHARESHARESHARESHAR&mode=test",
    ])
    assert.equal(
      await page
        .locator('.harness-program-card a[href="?dev&program=p-1"]')
        .count(),
      1,
    )
  })
})

test("registering a program adds a card, regenerating changes links, deleting removes it", async () => {
  await withPage(async ({ page, baseUrl }) => {
    page.on("dialog", dialog => dialog.accept())
    await open(page, baseUrl)
    await page.click(".harness-signin button")
    await page.waitForSelector(".harness-program-card")

    await page.fill('.harness-register input[name="key"]', "zzz9999")
    await page.fill('.harness-register input[name="label"]', "New one")
    await page.click('.harness-register button[type="submit"]')
    await page.waitForFunction(
      () => document.querySelectorAll(".harness-program-card").length === 2,
    )
    const newCard = page.locator(".harness-program-card", {
      hasText: "New one",
    })
    assert.match(
      await newCard.locator(".harness-link input").first().inputValue(),
      /\?r=S[A-Za-z0-9]{23}&mode=run$/,
    )

    await newCard.locator('[data-action="regenerate"]').click()
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll(".harness-link input")).some(i =>
        i.value.includes("?r=R"),
      ),
    )
    assert.match(
      await newCard.locator(".harness-link input").first().inputValue(),
      /\?r=R[A-Za-z0-9]{23}&mode=run$/,
    )

    await newCard.locator('[data-action="delete"]').click()
    await page.waitForFunction(
      () => document.querySelectorAll(".harness-program-card").length === 1,
    )
    assert.ok(
      await page.evaluate(() => window.store.calls.includes("deleteProgram")),
    )
  })
})

test("registering a key you already registered shows a friendly error", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click(".harness-signin button")
    await page.waitForSelector(".harness-program-card")
    await page.fill('.harness-register input[name="key"]', "abc1234")
    await page.click('.harness-register button[type="submit"]')
    const error = page.locator(".harness-register .harness-error")
    await error.waitFor({ state: "visible" })
    assert.equal(
      await error.innerText(),
      "You already registered this program key.",
    )
    assert.equal(await page.locator(".harness-program-card").count(), 1)
  })
})

test("sign out returns to the prompt", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click(".harness-signin button")
    await page.waitForSelector(".harness-program-card")
    await page.click('[data-action="signout"]')
    await page.waitForSelector(".harness-signin")
  })
})

test("a failed regenerate shows an error on the card and keeps the links", async () => {
  await withPage(async ({ page, baseUrl }) => {
    page.on("dialog", dialog => dialog.accept())
    await open(page, baseUrl)
    await page.click(".harness-signin button")
    await page.waitForSelector(".harness-program-card")
    await page.evaluate(() => {
      window.store.regenerateShare = async () => {
        throw new Error("offline")
      }
    })
    const card = page.locator(".harness-program-card").first()
    await card.locator('[data-action="regenerate"]').click()
    await card.locator(".harness-error").waitFor({ state: "visible" })
    assert.match(await card.locator(".harness-error").innerText(), /offline/)
    assert.equal(await page.locator(".harness-program-card").count(), 1)
    assert.match(
      await card.locator(".harness-link input").first().inputValue(),
      /\?r=SHARESHARESHARESHARESHAR/,
    )
  })
})

test("dismissing the confirmation cancels a delete", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click(".harness-signin button")
    await page.waitForSelector(".harness-program-card")
    page.once("dialog", dialog => dialog.dismiss())
    await page
      .locator(".harness-program-card")
      .first()
      .locator('[data-action="delete"]')
      .click()
    assert.equal(await page.locator(".harness-program-card").count(), 1)
    assert.ok(
      !(await page.evaluate(() =>
        window.store.calls.includes("deleteProgram"),
      )),
    )
  })
})

test("an auth event for the same user does not re-render", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click(".harness-signin button")
    await page.waitForSelector(".harness-program-card")
    await page.fill('.harness-register input[name="key"]', "zzz1111")
    await page.evaluate(() => window.store.emitAuth())
    await page.waitForTimeout(200)
    assert.equal(
      await page.inputValue('.harness-register input[name="key"]'),
      "zzz1111",
    )
  })
})
