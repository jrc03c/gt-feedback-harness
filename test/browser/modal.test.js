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

test("cancel then discard closes without sending", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click('[data-action="cancel"]')
    assert.equal(await page.evaluate(() => window.cancelled), 0)
    await page.click('.harness-confirm [data-action="discard"]')
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
      "Click a mark to select it, or drag a box around several. Shift-click adds, Ctrl-click (Cmd-click on Mac) toggles. Drag to move. Delete removes.",
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

const tool = page => page.evaluate(() => window.modal.editor.getTool())
const confirmCount = page => page.locator(".harness-confirm").count()

test("Escape with a drawing tool active switches to Select", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.keyboard.press("Escape")
    assert.equal(await tool(page), "select")
    assert.equal(
      await page.locator('[data-tool="select"][aria-pressed="true"]').count(),
      1,
    )
    assert.equal(await confirmCount(page), 0)
  })
})

test("Escape with Select active asks to discard; Escape again closes only the question", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    const confirm = page.locator(".harness-confirm")
    assert.equal(await confirm.count(), 1)
    assert.equal(await confirm.getAttribute("role"), "alertdialog")
    assert.equal(await confirm.getAttribute("aria-modal"), "true")
    assert.equal(
      await confirm.getAttribute("aria-label"),
      "Discard this feedback?",
    )
    assert.equal(
      await confirm.locator('[data-action="discard"]').innerText(),
      "Discard",
    )
    assert.equal(
      await confirm.locator('[data-action="keep"]').innerText(),
      "Keep editing",
    )

    await page.keyboard.press("Escape")
    assert.equal(await confirmCount(page), 0)
    assert.equal(await page.locator(".harness-modal").count(), 1)
    assert.equal(await page.evaluate(() => window.cancelled), 0)
  })
})

test("cancel then Keep editing leaves the modal open", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await drawStroke(page)
    await page.click('[data-action="cancel"]')
    assert.equal(await confirmCount(page), 1)
    await page.click('.harness-confirm [data-action="keep"]')
    assert.equal(await confirmCount(page), 0)
    assert.equal(await page.locator(".harness-modal").count(), 1)
    assert.equal(await page.evaluate(() => window.cancelled), 0)
    assert.equal(await annotationCount(page), 1)
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.classList.contains("harness-modal"),
      ),
      true,
    )
  })
})

test("the discard question sits above the dialog", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click('[data-action="cancel"]')
    const box = await page.locator(".harness-confirm").boundingBox()
    const viewport = page.viewportSize()
    assert.ok(box.width >= viewport.width - 1, JSON.stringify(box))
    // The discard button is the topmost element where it is drawn.
    const onTop = await page.evaluate(() => {
      const button = document.querySelector('[data-action="discard"]')
      const rect = button.getBoundingClientRect()
      return (
        document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ) === button
      )
    })
    assert.equal(onTop, true)
  })
})

test("Escape while typing in a note only leaves the note", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click('[data-tool="callout"]')
    const box = await page.locator(".harness-annotator img").boundingBox()
    await page.mouse.click(box.x + 100, box.y + 200)
    await page.keyboard.type("Hi")
    const before = await tool(page)
    await page.keyboard.press("Escape")
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("data-role"),
      ),
      null,
    )
    assert.equal(await tool(page), before)
    assert.equal(await confirmCount(page), 0)
    assert.equal(await page.locator(".harness-modal").count(), 1)
    const [note] = await page.evaluate(() =>
      window.modal.editor.getAnnotations(),
    )
    assert.equal(note.text, "Hi")
  })
})

const overlayFocused = page =>
  page.evaluate(() =>
    document.activeElement.classList.contains("harness-modal"),
  )

test("Escape in the feedback box only leaves it (Pen active)", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.focus(".harness-text")
    await page.keyboard.press("Escape")
    assert.equal(await tool(page), "pen")
    assert.equal(await confirmCount(page), 0)
    assert.equal(await overlayFocused(page), true)
  })
})

test("Escape in the feedback box only leaves it (Select active)", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click('[data-tool="select"]')
    await page.fill(".harness-text", "draft")
    await page.focus(".harness-text")
    await page.keyboard.press("Escape")
    assert.equal(await tool(page), "select")
    assert.equal(await confirmCount(page), 0)
    assert.equal(await overlayFocused(page), true)
    assert.equal(await page.inputValue(".harness-text"), "draft")
  })
})

test("buttons leave a gap between their icon and their label", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    const gaps = await page.evaluate(() =>
      [...document.querySelectorAll(".harness-modal button")]
        .filter(button => button.querySelector(".harness-icon"))
        .map(button => {
          const icon = button
            .querySelector(".harness-icon")
            .getBoundingClientRect()
          const label = button
            .querySelector(".harness-label")
            .getBoundingClientRect()
          return {
            name: button.textContent.trim(),
            gap: label.left - icon.right,
          }
        }),
    )
    assert.ok(gaps.length >= 5, `found ${gaps.length} icon buttons`)
    for (const { name, gap } of gaps)
      assert.ok(gap >= 4, `${name}: gap of ${gap}px between icon and label`)
  })
})
