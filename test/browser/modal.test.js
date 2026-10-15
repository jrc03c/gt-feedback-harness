import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage, drag } from "../helpers/browser.js"

async function open(page, baseUrl) {
  await page.goto(`${baseUrl}/test/fixtures/modal.html`)
  await page.waitForFunction(() => window.fixtureReady === true)
  await page.evaluate(() => window.openModal())
  await page.waitForSelector(".harness-modal")
}

test("opens with the pen tool selected and a hint", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    assert.equal(
      await page.locator(".harness-modal[data-harness-chrome]").count(),
      1,
    )
    assert.equal(await page.locator(".harness-toolbar [data-tool]").count(), 4)
    assert.equal(
      await page.locator('[data-tool="pen"][aria-pressed="true"]').count(),
      1,
    )
    assert.equal(
      await page.locator(".harness-hint").innerText(),
      "Draw on the screenshot.",
    )
    assert.equal(
      await page.evaluate(() => window.modal.editor.getTool()),
      "pen",
    )
  })
})

test("switching tools updates the editor, button state, and hint", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click('[data-tool="callout"]')
    assert.equal(
      await page.evaluate(() => window.modal.editor.getTool()),
      "callout",
    )
    assert.equal(
      await page.locator('[data-tool="callout"][aria-pressed="true"]').count(),
      1,
    )
    assert.equal(
      await page.locator('[data-tool="pen"][aria-pressed="true"]').count(),
      0,
    )
    assert.equal(
      await page.locator(".harness-hint").innerText(),
      "Click where the note should point.",
    )
  })
})

test("send passes annotations and text, then closes", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.fill(".harness-text", "  Looks wrong  ")
    await page.click('[data-action="send"]')
    await page.waitForSelector(".harness-modal", { state: "detached" })
    const sent = await page.evaluate(() => window.sent)
    assert.deepEqual(sent, [{ annotations: [], text: "Looks wrong" }])
  })
})

test("a failed send shows the error and offers retry", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.evaluate(() => (window.failNext = true))
    await page.click('[data-action="send"]')
    await page.waitForSelector(".harness-error:not([hidden])")
    assert.match(
      await page.locator(".harness-error").innerText(),
      /network down/,
    )
    assert.equal(
      await page.locator('[data-action="send"]').innerText(),
      "Retry",
    )
    assert.equal(await page.locator('[data-action="send"]:disabled').count(), 0)
    assert.equal(await page.locator(".harness-modal").count(), 1)

    await page.click('[data-action="send"]')
    await page.waitForSelector(".harness-modal", { state: "detached" })
    assert.equal(await page.evaluate(() => window.sent.length), 2)
  })
})

test("cancel is disabled while sending", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.evaluate(() => (window.deferSend = true))
    await page.click('[data-action="send"]')
    assert.equal(
      await page.locator('[data-action="cancel"]:disabled').count(),
      1,
    )
    assert.equal(await page.locator('[data-action="send"]:disabled').count(), 1)
    await page.evaluate(() => window.pendingSend.resolve())
    await page.waitForSelector(".harness-modal", { state: "detached" })
    assert.equal(await page.evaluate(() => window.cancelled), 0)
    assert.equal(await page.evaluate(() => window.sent.length), 1)
  })
})

test("cancel closes without sending", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click('[data-action="cancel"]')
    await page.waitForSelector(".harness-modal", { state: "detached" })
    assert.equal(await page.evaluate(() => window.cancelled), 1)
    assert.equal(await page.evaluate(() => window.sent.length), 0)
  })
})

test("controls render the feedback button and the name field", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/modal.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    await page.evaluate(() => {
      window.controls = window.harness.createControls({
        root: document.getElementById("root"),
        onFeedback: () => window.clicks++,
        name: { value: "Bob", onChange: value => window.names.push(value) },
      })
    })
    assert.equal(
      await page.locator(".harness-controls[data-harness-chrome]").count(),
      1,
    )
    assert.match(
      await page.locator(".harness-feedback-button").innerText(),
      /Give feedback/,
    )
    await page.click(".harness-feedback-button")
    assert.equal(await page.evaluate(() => window.clicks), 1)

    assert.equal(await page.inputValue(".harness-name input"), "Bob")
    await page.fill(".harness-name input", "  Alice  ")
    await page.press(".harness-name input", "Tab")
    assert.deepEqual(await page.evaluate(() => window.names), ["Alice"])

    await page.evaluate(() => window.controls.setBusy(true))
    assert.equal(
      await page.locator(".harness-feedback-button:disabled").count(),
      1,
    )
  })
})

test("a tall phone screenshot fits the modal without scrolling", async () => {
  await withPage(
    async ({ page, baseUrl }) => {
      await page.goto(`${baseUrl}/test/fixtures/modal.html`)
      await page.waitForFunction(() => window.fixtureReady === true)
      await page.evaluate(() => {
        window.image = window.makeImage(780, 1688)
        window.openModal()
      })
      await page.waitForSelector(".harness-modal")
      await page.waitForFunction(() => {
        const img = document.querySelector(".harness-annotator img")
        return img && img.complete && img.naturalWidth > 0
      })

      const sizes = await page.evaluate(() => {
        const editor = document.querySelector(".harness-editor")
        const img = document.querySelector(".harness-annotator img")
        const svg = document.querySelector(".harness-annotator-svg")
        const imgRect = img.getBoundingClientRect()
        const svgRect = svg.getBoundingClientRect()
        return {
          scrollHeight: editor.scrollHeight,
          clientHeight: editor.clientHeight,
          scrollWidth: editor.scrollWidth,
          clientWidth: editor.clientWidth,
          img: [imgRect.width, imgRect.height],
          svg: [svgRect.width, svgRect.height],
          natural: [img.naturalWidth, img.naturalHeight],
        }
      })

      assert.ok(sizes.scrollHeight <= sizes.clientHeight, JSON.stringify(sizes))
      assert.ok(sizes.scrollWidth <= sizes.clientWidth, JSON.stringify(sizes))
      assert.ok(sizes.img[0] < sizes.natural[0], JSON.stringify(sizes))
      assert.ok(sizes.img[1] < sizes.natural[1], JSON.stringify(sizes))
      assert.ok(
        Math.abs(sizes.svg[0] - sizes.img[0]) < 1,
        JSON.stringify(sizes),
      )
      assert.ok(
        Math.abs(sizes.svg[1] - sizes.img[1]) < 1,
        JSON.stringify(sizes),
      )
    },
    { viewport: { width: 390, height: 844 } },
  )
})

test("drawing in a wide modal maps to image pixels", async () => {
  await withPage(
    async ({ page, baseUrl }) => {
      await open(page, baseUrl)
      const box = await page.locator(".harness-annotator img").boundingBox()
      // The 400x300 image is narrower than the editor, so it is centred.
      await drag(
        page,
        [box.x + box.width * 0.25, box.y + box.height * 0.5],
        [box.x + box.width * 0.75, box.y + box.height * 0.5],
      )
      const [stroke] = await page.evaluate(() =>
        window.modal.editor.getAnnotations(),
      )
      const points = stroke.points.map(([x, y]) => [
        Math.round(x),
        Math.round(y),
      ])
      assert.deepEqual(points, [
        [100, 150],
        [300, 150],
      ])
    },
    { viewport: { width: 1280, height: 900 } },
  )
})

test("placing a note returns the toolbar to Select", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click('[data-tool="callout"]')
    const box = await page.locator(".harness-annotator img").boundingBox()
    await page.mouse.click(box.x + 100, box.y + 200)
    assert.equal(
      await page.locator('[data-tool="select"][aria-pressed="true"]').count(),
      1,
    )
    assert.equal(await page.locator('[aria-pressed="true"]').count(), 1)
    assert.equal(
      await page.locator(".harness-hint").innerText(),
      "Click a mark to select it. Drag to move it. Press Delete to remove it.",
    )
  })
})

async function drawStroke(page) {
  const box = await page.locator(".harness-annotator img").boundingBox()
  await drag(page, [box.x + 50, box.y + 50], [box.x + 150, box.y + 50])
}

const annotationCount = page =>
  page.evaluate(() => window.modal.editor.getAnnotations().length)

test("keyboard shortcuts undo and redo", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await drawStroke(page)
    assert.equal(await annotationCount(page), 1)
    await page.keyboard.press("Control+z")
    assert.equal(await annotationCount(page), 0)
    await page.keyboard.press("Control+Shift+z")
    assert.equal(await annotationCount(page), 1)
    await page.keyboard.press("Control+z")
    assert.equal(await annotationCount(page), 0)
    await page.keyboard.press("Control+y")
    assert.equal(await annotationCount(page), 1)
  })
})

test("shortcuts work right after opening and not while typing", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.classList.contains("harness-modal"),
      ),
      true,
    )
    await drawStroke(page)
    await page.fill(".harness-text", "abc")
    await page.focus(".harness-text")
    await page.keyboard.press("Control+z")
    assert.equal(await annotationCount(page), 1)
  })
})

test("the Redo button reapplies an undone change", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    const labels = await page
      .locator(".harness-toolbar [data-action]")
      .evaluateAll(buttons => buttons.map(b => b.dataset.action))
    assert.deepEqual(labels, ["undo", "redo", "delete"])
    await drawStroke(page)
    await page.click('[data-action="undo"]')
    assert.equal(await annotationCount(page), 0)
    await page.click('[data-action="redo"]')
    assert.equal(await annotationCount(page), 1)
  })
})
