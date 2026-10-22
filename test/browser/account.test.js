import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

async function openAccount(page, baseUrl) {
  await page.goto(`${baseUrl}/test/fixtures/developer.html`)
  await page.waitForFunction(() => window.fixtureReady === true)
  await page.evaluate(() => window.mount())
  await page.click(".harness-signin button")
  await page.waitForSelector(".harness-program-card")
  await page.evaluate(() => window.mountAccount())
  await page.waitForSelector(".harness-account")
}

test("the account page shows who is signed in, with a way back and a delete button", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openAccount(page, baseUrl)
    const text = await page.locator(".harness-account").innerText()
    assert.match(text, /octocat/)
    assert.match(text, /dev@example\.com/)
    assert.equal(
      await page.locator('.harness-account a[href="?dev"]').count(),
      1,
    )
    assert.equal(
      await page
        .locator('.harness-account [data-action="delete-account"]')
        .innerText(),
      "Delete account",
    )
    assert.equal(
      await page.locator(".harness-topbar a.harness-user").innerText(),
      "octocat",
    )
  })
})

test("deleting the account asks first, then removes everything and signs out", async () => {
  await withPage(async ({ page, baseUrl }) => {
    const messages = []
    page.on("dialog", dialog => {
      messages.push(dialog.message())
      dialog.accept()
    })
    await openAccount(page, baseUrl)
    await page.click('.harness-account [data-action="delete-account"]')
    await page.waitForSelector(".harness-signin")
    assert.equal(messages.length, 1)
    assert.match(messages[0], /programs/)
    assert.match(messages[0], /cannot be undone/)
    const calls = await page.evaluate(() => window.store.calls)
    assert.ok(calls.includes("deleteAccount"), calls.join(","))
    assert.equal(await page.evaluate(() => window.store.getUser()), null)
    assert.equal(
      await page.evaluate(
        async () => (await window.store.listPrograms()).length,
      ),
      0,
    )
  })
})

test("cancelling the confirmation keeps the account", async () => {
  await withPage(async ({ page, baseUrl }) => {
    page.on("dialog", dialog => dialog.dismiss())
    await openAccount(page, baseUrl)
    await page.click('.harness-account [data-action="delete-account"]')
    await page.waitForTimeout(200)
    assert.equal(await page.locator(".harness-account").count(), 1)
    const calls = await page.evaluate(() => window.store.calls)
    assert.ok(!calls.includes("deleteAccount"))
  })
})

test("a failed deletion shows an error and stays on the page", async () => {
  await withPage(async ({ page, baseUrl }) => {
    page.on("dialog", dialog => dialog.accept())
    await openAccount(page, baseUrl)
    await page.evaluate(() => {
      window.store.deleteAccount = async () => {
        throw new Error("network down")
      }
    })
    await page.click('.harness-account [data-action="delete-account"]')
    await page.waitForSelector(
      ".harness-danger-zone .harness-error:not([hidden])",
    )
    assert.match(
      await page.locator(".harness-danger-zone .harness-error").innerText(),
      /network down/,
    )
    assert.equal(
      await page
        .locator('.harness-account [data-action="delete-account"]')
        .isDisabled(),
      false,
    )
  })
})

test("generating a script password shows it once as .env lines", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openAccount(page, baseUrl)
    const section = page.locator(".harness-script-access")
    assert.match(await section.innerText(), /Script access/)
    assert.equal(await section.locator("pre").count(), 0)
    await section.locator('[data-action="script-password"]').click()
    await page.waitForSelector(".harness-script-access pre")
    const text = await section.locator("pre").innerText()
    assert.match(text, /^GT_FEEDBACK_HARNESS_EMAIL="dev@example\.com"\n/)
    assert.match(text, /GT_FEEDBACK_HARNESS_PASSWORD="[A-Za-z0-9]{32}"$/)
    const calls = await page.evaluate(() => window.store.calls)
    assert.ok(calls.includes("setScriptPassword"), calls.join(","))
  })
})

test("a failed script password generation shows an error", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openAccount(page, baseUrl)
    await page.evaluate(() => {
      window.store.setScriptPassword = async () => {
        throw new Error("auth down")
      }
    })
    await page.click('.harness-script-access [data-action="script-password"]')
    await page.waitForSelector(
      ".harness-script-access .harness-error:not([hidden])",
    )
    assert.match(
      await page.locator(".harness-script-access .harness-error").innerText(),
      /auth down/,
    )
    assert.equal(
      await page
        .locator('.harness-script-access [data-action="script-password"]')
        .isDisabled(),
      false,
    )
  })
})
