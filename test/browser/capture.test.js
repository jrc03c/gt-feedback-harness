import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

const capture = page =>
  page.evaluate(async () => {
    const { captureViewport, pixelAt } = window.harness
    const result = await captureViewport({ scale: 1 })
    return {
      type: result.blob.type,
      width: result.width,
      height: result.height,
      corner: await pixelAt(result.blob, 10, 10),
      middle: await pixelAt(result.blob, 400, 400),
    }
  })

test("captures the viewport, excluding harness chrome", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/capture.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    const result = await capture(page)
    assert.equal(result.type, "image/webp")
    assert.equal(result.width, 800)
    assert.equal(result.height, 600)
    assert.ok(
      result.corner.r > 200 && result.corner.b < 80,
      `expected red, got ${JSON.stringify(result.corner)}`,
    )
    assert.ok(
      result.middle.r > 240 && result.middle.g > 240 && result.middle.b > 240,
      `expected white, got ${JSON.stringify(result.middle)}`,
    )
  })
})

test("captures the scrolled viewport, not the top of the page", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/capture.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    await page.evaluate(() => window.scrollTo(0, 1000))
    const result = await capture(page)
    assert.ok(
      result.corner.g > 200 && result.corner.r < 80,
      `expected green, got ${JSON.stringify(result.corner)}`,
    )
  })
})

test("an audio element with several sources does not delay or blank the capture", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/capture.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    // GuidedTrack's *audio renders two <source> children. Inside the SVG the
    // capture is drawn from, an audio element with two absolute-URL sources
    // never finishes loading, so the capture stalls for the whole timeout and
    // then draws nothing. Data URLs reproduce it without any network.
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div style="position:absolute;left:400px;top:0">
          <audio controls>
            <source src="data:audio/mpeg;base64,AAAA" type="audio/mpeg" />
            <source src="data:audio/ogg;base64,AAAA" type="audio/ogg" />
          </audio>
        </div>`,
      )
    })
    const started = Date.now()
    const result = await capture(page)
    const elapsed = Date.now() - started
    assert.ok(elapsed < 10000, `capture took ${elapsed} ms`)
    assert.ok(
      result.corner.r > 200 && result.corner.b < 80,
      `expected red, got ${JSON.stringify(result.corner)}`,
    )
  })
})

test("a centred container stays centred even when the browser misreports its auto margin", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/capture-centered.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    const reported = await page.evaluate(() => window.showPointsChange())
    const left = await page.evaluate(
      () =>
        document.querySelector(".program_container").getBoundingClientRect()
          .left,
    )
    assert.equal(left, 16, "the live container is centred")
    assert.equal(
      reported,
      "0px",
      "Chromium misreports the margin (the quirk this test guards)",
    )

    const result = await page.evaluate(async () => {
      const { captureViewport, pixelAt } = window.harness
      const r = await captureViewport({ scale: 1 })
      return {
        gutter: await pixelAt(r.blob, 8, 150),
        inside: await pixelAt(r.blob, 100, 150),
      }
    })
    assert.ok(
      result.gutter.r > 240 && result.gutter.g > 240 && result.gutter.b > 240,
      `expected white gutter, got ${JSON.stringify(result.gutter)}`,
    )
    assert.ok(
      result.inside.b > 200 && result.inside.r < 60,
      `expected blue container, got ${JSON.stringify(result.inside)}`,
    )
  })
})
