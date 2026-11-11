import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

async function openReviewer(page, baseUrl, key, mode, assetBase) {
  await page.goto(`${baseUrl}/test/fixtures/reviewer.html`)
  await page.waitForFunction(() => window.fixtureReady === true)
  await page.evaluate(
    ({ key, mode, assetBase }) => window.mount(key, mode, assetBase),
    { key, mode, assetBase },
  )
}

test("runs the program and sends feedback with context", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openReviewer(page, baseUrl, "abc1234", "test")
    await page.waitForSelector(".program_container .main p")
    assert.equal(await page.locator(".harness-controls").count(), 1)

    await page.fill(".harness-name input", "Alice")
    await page.press(".harness-name input", "Tab")

    await page.click(".harness-feedback-button")
    await page.waitForSelector(".harness-modal")
    assert.equal(await page.locator(".harness-modal img").count(), 1)

    await page.fill(".harness-text", "Button is misaligned")
    await page.click('[data-action="send"]')
    await page.waitForSelector(".harness-modal", { state: "detached" })

    const [item] = await page.evaluate(() => window.sent)
    assert.equal(item.key, "abc1234")
    assert.equal(item.mode, "test")
    assert.equal(item.text, "Button is misaligned")
    assert.deepEqual(item.annotations, [])
    assert.equal(item.reviewerName, "Alice")
    assert.equal(item.imageWidth, 800)
    assert.equal(item.imageHeight, 600)
    assert.equal(item.imageType, "image/webp")
    assert.deepEqual(item.context.lines, [
      { from: 1, to: 3, program: "main" },
      { from: 10, to: 12, program: "main" },
    ])
    assert.equal(item.context.runId, "run-123")
    assert.deepEqual(item.context.variables, { name: "Alice", score: 42 })
    assert.deepEqual(item.context.viewport, { width: 800, height: 600 })

    const stored = await page.evaluate(() =>
      localStorage.getItem("harness:reviewer-name"),
    )
    assert.equal(stored, "Alice")
  })
})

test("a link with capture=screen screenshots through the Screen Capture API, hiding the harness controls", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/reviewer.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    await page.evaluate(() => {
      window.installFakeDisplay()
      return window.mount("abc1234", "test", undefined, undefined, "screen")
    })
    await page.waitForSelector(".program_container .main p")
    await page.click(".harness-feedback-button")
    await page.waitForSelector(".harness-modal img")
    const pixel = await page.evaluate(async () => {
      const src = document.querySelector(".harness-modal img").src
      const blob = await (await fetch(src)).blob()
      return window.harness.pixelAt(blob, 400, 300)
    })
    assert.ok(
      pixel.g > 180 && pixel.r < 60 && pixel.b < 60,
      `expected the shared tab's frame with the controls hidden, got ${JSON.stringify(pixel)}`,
    )
    assert.equal(await page.evaluate(() => window.fakeDisplayCalls.length), 1)
  })
})

test("the context snapshot is taken when the button is clicked, not after capture", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openReviewer(page, baseUrl, "abc1234", "test")
    await page.waitForSelector(".program_container .main p")

    await page.evaluate(() => {
      document.querySelector(".harness-feedback-button").click()
      document.querySelector(".program_container .main .next").click()
    })

    await page.waitForSelector(".harness-modal")
    await page.fill(".harness-text", "racing the capture")
    await page.click('[data-action="send"]')
    await page.waitForSelector(".harness-modal", { state: "detached" })

    const [item] = await page.evaluate(() => window.sent)
    assert.deepEqual(item.context.lines, [
      { from: 1, to: 3, program: "main" },
      { from: 10, to: 12, program: "main" },
    ])
  })
})

test("shows setup instructions when the embed is refused", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openReviewer(page, baseUrl, "refused", "test")
    await page.waitForSelector(".harness-banner")
    assert.match(
      await page.locator(".harness-banner h2").innerText(),
      /isn't set up/,
    )
    assert.match(
      await page.locator(".harness-url").innerText(),
      /\/test\/fixtures\/reviewer\.html$/,
    )
  })
})

test("shows an error when GuidedTrack cannot be loaded", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openReviewer(
      page,
      baseUrl,
      "abc1234",
      "test",
      "/test/fixtures/does-not-exist",
    )
    await page.waitForSelector(".harness-banner")
    assert.match(
      await page.locator(".harness-message").innerText(),
      /Could not load GuidedTrack/,
    )
  })
})

test("opens the modal with a placeholder when capture fails", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/reviewer.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    await page.evaluate(() =>
      window.mount("abc1234", "test", undefined, async () => {
        throw new Error("boom")
      }),
    )
    await page.waitForSelector(".program_container .main p")

    await page.click(".harness-feedback-button")
    await page.waitForSelector(".harness-modal")
    assert.match(
      await page.locator(".harness-modal img").getAttribute("src"),
      /^blob:/,
    )

    await page.click('[data-action="send"]')
    await page.waitForSelector(".harness-modal", { state: "detached" })
    const [item] = await page.evaluate(() => window.sent)
    assert.equal(item.imageType, "image/png")
    assert.equal(item.imageWidth, 800)
    assert.equal(item.imageHeight, 600)
    // The object URL is revoked once sendFeedback resolves.
    const stillLoads = await page.evaluate(
      url =>
        fetch(url).then(
          () => true,
          () => false,
        ),
      item.imageUrl,
    )
    assert.equal(stillLoads, false)
  })
})
