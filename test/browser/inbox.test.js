import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

async function open(page, baseUrl) {
  await page.goto(`${baseUrl}/test/fixtures/inbox.html`)
  await page.waitForFunction(() => window.fixtureReady === true)
}

test("the inbox lists sessions newest first with counts, filters, and deletes", async () => {
  await withPage(async ({ page, baseUrl }) => {
    page.on("dialog", dialog => dialog.accept())
    await open(page, baseUrl)
    await page.evaluate(() => window.mountInbox())
    await page.waitForSelector(".harness-inbox tbody tr")
    assert.match(await page.locator(".harness-inbox h1").innerText(), /Demo/)
    const rows = await page.locator(".harness-inbox tbody tr").allInnerTexts()
    assert.equal(rows.length, 2)
    assert.match(rows[0], /Anonymous.*run.*0 items/s)
    assert.match(rows[1], /Alice.*test.*5 min.*3 items \(2 unresolved\)/s)
    assert.equal(
      await page.locator('.harness-inbox a[href="?session=s-1"]').count(),
      1,
    )

    await page.check(".harness-inbox input[type=checkbox]")
    assert.equal(await page.locator(".harness-inbox tbody tr").count(), 1)
    await page.uncheck(".harness-inbox input[type=checkbox]")

    await page
      .locator('.harness-inbox tbody tr:nth-child(1) [data-action="delete"]')
      .click()
    await page.waitForFunction(
      () => document.querySelectorAll(".harness-inbox tbody tr").length === 1,
    )
    assert.ok(
      await page.evaluate(() => window.store.calls.includes("deleteSession")),
    )
  })
})

test("the session view renders items with the annotated screenshot, text, context, resolve, and download", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.evaluate(() => window.mountSession("s-1"))
    await page.waitForSelector(".harness-item img")
    assert.match(await page.locator(".harness-session h1").innerText(), /Demo/)
    assert.equal(await page.locator(".harness-item").count(), 3)

    const first = page.locator(".harness-item").first()
    assert.match(
      await first.locator(".harness-item-text").innerText(),
      /Button is misaligned/,
    )
    assert.equal(
      await first
        .locator("svg[data-mode=static] g[data-type=pen] path")
        .count(),
      1,
    )
    await first.locator("details summary").click()
    assert.match(await first.locator("details").innerText(), /main: lines 1-3/)
    assert.match(await first.locator("details").innerText(), /score.*42/s)
    assert.equal(
      await page.locator(".harness-item.harness-resolved").count(),
      1,
    )

    await first.locator('[data-action="resolve"]').click()
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".harness-item.harness-resolved").length ===
        2,
    )
    assert.ok(
      await page.evaluate(() =>
        window.store.calls.includes("setResolved:true"),
      ),
    )

    const [downloadEvent] = await Promise.all([
      page.waitForEvent("download"),
      first.locator('[data-action="download"]').click(),
    ])
    assert.match(
      downloadEvent.suggestedFilename(),
      /^feedback-abc1234-i-1\.png$/,
    )
  })
})

test("a failed delete shows an error and keeps the row", async () => {
  await withPage(async ({ page, baseUrl }) => {
    page.on("dialog", dialog => dialog.accept())
    await open(page, baseUrl)
    await page.evaluate(() => {
      window.store.deleteSession = async () => {
        throw new Error("offline")
      }
    })
    await page.evaluate(() => window.mountInbox())
    await page.waitForSelector(".harness-inbox tbody tr")
    await page
      .locator('.harness-inbox tbody tr:nth-child(1) [data-action="delete"]')
      .click()
    await page.waitForSelector(".harness-inbox .harness-error:not([hidden])")
    assert.match(
      await page.locator(".harness-inbox .harness-error").innerText(),
      /offline/,
    )
    assert.equal(await page.locator(".harness-inbox tbody tr").count(), 2)
  })
})

test("a failed resolve shows an error on the card", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.evaluate(() => {
      window.store.setResolved = async () => {
        throw new Error("denied")
      }
    })
    await page.evaluate(() => window.mountSession("s-1"))
    await page.waitForSelector(".harness-item img")
    const first = page.locator(".harness-item").first()
    await first.locator('[data-action="resolve"]').click()
    await first.locator(".harness-error:not([hidden])").waitFor()
    assert.match(await first.locator(".harness-error").innerText(), /denied/)
    assert.equal(
      await first.evaluate(el => el.classList.contains("harness-resolved")),
      false,
    )
  })
})

test("items without a screenshot hide the download button", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.evaluate(() => window.mountSession("s-1"))
    await page.waitForSelector(".harness-item img")
    const buttons = page.locator('.harness-item [data-action="download"]')
    assert.equal(await buttons.nth(0).isVisible(), true)
    assert.equal(await buttons.nth(1).isVisible(), true)
    assert.equal(await buttons.nth(2).isHidden(), true)
  })
})
