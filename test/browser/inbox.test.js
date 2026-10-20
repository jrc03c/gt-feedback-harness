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
    assert.match(rows[1], /Alice.*test.*5 min.*3 items.*2 unresolved/s)
    const view = page.locator('.harness-inbox a[href="?session=s-1"]')
    assert.equal(await view.innerText(), "View")
    // The link and the Delete button share a row with a clear gap, even next
    // to the "unresolved" badge.
    const [link, button] = await Promise.all([
      view.boundingBox(),
      view.locator("xpath=following-sibling::button").boundingBox(),
    ])
    assert.ok(
      Math.abs(link.y + link.height / 2 - (button.y + button.height / 2)) < 4,
      `expected the same row, got ${JSON.stringify([link, button])}`,
    )
    assert.ok(
      button.x - (link.x + link.width) >= 12,
      `expected a gap of 12px or more, got ${button.x - (link.x + link.width)}`,
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

test("clicking a column header sorts the rows and clicking it again reverses them", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.evaluate(() => window.mountInbox())
    await page.waitForSelector(".harness-inbox tbody tr")
    const firstCells = () =>
      page.locator(".harness-inbox tbody tr td:first-child").allInnerTexts()
    const sortState = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".harness-inbox th")].map(
          th => th.getAttribute("aria-sort") || "",
        ),
      )
    assert.deepEqual(await firstCells(), ["Anonymous", "Alice"])
    assert.deepEqual(await sortState(), ["", "", "descending", "", "", ""])

    await page.locator('.harness-inbox th[data-sort="reviewer"] button').click()
    assert.deepEqual(await firstCells(), ["Alice", "Anonymous"])
    assert.deepEqual(await sortState(), ["ascending", "", "", "", "", ""])

    await page.locator('.harness-inbox th[data-sort="reviewer"] button').click()
    assert.deepEqual(await firstCells(), ["Anonymous", "Alice"])
    assert.deepEqual(await sortState(), ["descending", "", "", "", "", ""])

    await page.locator('.harness-inbox th[data-sort="feedback"] button').click()
    assert.deepEqual(await firstCells(), ["Alice", "Anonymous"])
    assert.deepEqual(await sortState(), ["", "", "", "", "descending", ""])
  })
})

test("sessions with unresolved items are flagged in the table", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.evaluate(() => window.mountInbox())
    await page.waitForSelector(".harness-inbox tbody tr")
    const flagged = page.locator(".harness-inbox tbody tr.harness-unresolved")
    assert.equal(await flagged.count(), 1)
    assert.match(await flagged.innerText(), /^Alice/)
    assert.equal(
      await flagged.locator(".harness-badge").innerText(),
      "2 unresolved",
    )
    assert.equal(
      await page.locator(".harness-inbox tbody tr .harness-badge").count(),
      1,
    )
    const weight = await flagged
      .locator("td:first-child")
      .evaluate(td => getComputedStyle(td).fontWeight)
    assert.equal(weight, "700")
  })
})

test("clicking a screenshot opens it full size, and it can be opened in a new tab", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.evaluate(() => window.mountSession("s-1"))
    await page.waitForSelector(".harness-item img")
    assert.equal(await page.locator("dialog.harness-lightbox[open]").count(), 0)

    await page.locator(".harness-item-image").first().click()
    const lightbox = page.locator("dialog.harness-lightbox[open]")
    assert.equal(await lightbox.count(), 1)
    const natural = await lightbox
      .locator("img")
      .evaluate(img => [img.width, img.height])
    const stored = await page
      .locator(".harness-item img")
      .first()
      .evaluate(img => [img.width, img.height])
    assert.deepEqual(natural, stored)
    assert.equal(await lightbox.locator("svg[data-mode=static]").count(), 1)

    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      lightbox.locator('[data-action="open-tab"]').click(),
    ])
    assert.match(popup.url(), /^blob:/)
    await popup.close()

    await page.keyboard.press("Escape")
    assert.equal(await page.locator("dialog.harness-lightbox[open]").count(), 0)

    await page.locator(".harness-item-image").first().click()
    await page.locator("dialog.harness-lightbox [data-action=close]").click()
    assert.equal(await page.locator("dialog.harness-lightbox[open]").count(), 0)
  })
})

test("resolved items are grayed out while their buttons stay legible", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.evaluate(() => window.mountSession("s-1"))
    await page.waitForSelector(".harness-item img")
    const resolved = page.locator(".harness-item.harness-resolved").first()
    const styles = await resolved.evaluate(card => ({
      background: getComputedStyle(card).backgroundColor,
      cardFilter: getComputedStyle(card).filter,
      cardOpacity: getComputedStyle(card).opacity,
      imageFilter: getComputedStyle(card.querySelector(".harness-item-image"))
        .filter,
      textFilter: getComputedStyle(card.querySelector(".harness-item-text"))
        .filter,
      buttonOpacity: getComputedStyle(card.querySelector("button")).opacity,
    }))
    assert.equal(styles.background, "rgb(243, 243, 243)")
    assert.equal(styles.cardFilter, "none")
    assert.equal(styles.cardOpacity, "1")
    assert.match(styles.imageFilter, /grayscale\(1\)/)
    assert.match(styles.textFilter, /grayscale\(1\)/)
    assert.equal(styles.buttonOpacity, "1")
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
