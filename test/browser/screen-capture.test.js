import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

const isGreen = p => p.g > 180 && p.r < 60 && p.b < 60
const isRed = p => p.r > 180 && p.g < 60 && p.b < 60

async function open(page, baseUrl) {
  await page.goto(`${baseUrl}/test/fixtures/screen-capture.html`)
  await page.waitForFunction(() => window.fixtureReady === true)
}

// Captures once with a fake display of the given kind; returns a pixel in the
// middle of the page and the result's size.
const captureWith = (page, options) =>
  page.evaluate(async options => {
    const { createScreenCapture, pixelAt } = window.harness
    const fake = window.fakeDisplay(options)
    const capture = createScreenCapture({
      getDisplayMedia: fake.getDisplayMedia,
    })
    const result = await capture()
    const pixel = await pixelAt(result.blob, 400, 300)
    return {
      pixel,
      type: result.blob.type,
      width: result.width,
      height: result.height,
      scale: result.scale,
      calls: fake.calls.length,
      trackState: fake.track.readyState,
      chromeVisible:
        getComputedStyle(document.getElementById("chrome")).visibility !==
        "hidden",
    }
  }, options)

test("a frame of the shared tab becomes the screenshot, taken while the harness controls are hidden", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    const result = await captureWith(page, {})
    assert.ok(
      isGreen(result.pixel),
      `expected the frame taken with the chrome hidden, got ${JSON.stringify(result.pixel)}`,
    )
    assert.equal(result.type, "image/webp")
    assert.equal(result.width, 800)
    assert.equal(result.height, 600)
    assert.equal(result.scale, 1)
    assert.equal(result.chromeVisible, true, "the controls come back")
    assert.equal(result.trackState, "live", "the tab stays shared")
  })
})

test("without the Screen Capture API the DOM capture is used", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    const result = await page.evaluate(async () => {
      const { createScreenCapture, pixelAt } = window.harness
      const capture = createScreenCapture({ getDisplayMedia: null })
      const r = await capture()
      return { pixel: await pixelAt(r.blob, 400, 300), width: r.width }
    })
    assert.ok(
      isRed(result.pixel),
      `expected the DOM capture, got ${JSON.stringify(result.pixel)}`,
    )
    assert.equal(result.width, 800)
  })
})

test("a refused prompt falls back to the DOM capture", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    const result = await captureWith(page, { reject: true })
    assert.ok(
      isRed(result.pixel),
      `expected the DOM capture, got ${JSON.stringify(result.pixel)}`,
    )
    assert.equal(result.calls, 1)
  })
})

test("a shared window or screen is released and the DOM capture used instead", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    const result = await captureWith(page, { displaySurface: "monitor" })
    assert.ok(
      isRed(result.pixel),
      `expected the DOM capture, got ${JSON.stringify(result.pixel)}`,
    )
    assert.equal(result.trackState, "ended", "sharing is stopped")
  })
})

test("the shared tab is reused until the reviewer stops sharing", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    const calls = await page.evaluate(async () => {
      const { createScreenCapture } = window.harness
      const fake = window.fakeDisplay()
      const capture = createScreenCapture({
        getDisplayMedia: fake.getDisplayMedia,
      })
      await capture()
      await capture()
      const afterTwo = fake.calls.length
      fake.track.stop()
      // The fake hands back the same, now ended, stream: no frame ever
      // arrives, which must end in the DOM capture rather than an error.
      const third = await capture()
      return {
        afterTwo,
        afterStop: fake.calls.length,
        third: await window.harness.pixelAt(third.blob, 400, 300),
      }
    })
    assert.equal(calls.afterTwo, 1, "one prompt for two captures")
    assert.equal(calls.afterStop, 2, "prompted again after sharing stopped")
    assert.ok(
      isRed(calls.third),
      `expected the DOM capture when no frame arrives, got ${JSON.stringify(calls.third)}`,
    )
  })
})
