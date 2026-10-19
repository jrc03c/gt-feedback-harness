import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage, drag } from "../helpers/browser.js"

async function openEditor(page, baseUrl) {
  await page.goto(`${baseUrl}/test/fixtures/editor.html`)
  await page.waitForFunction(() => window.editorReady === true)
}

const annotations = page => page.evaluate(() => window.editor.getAnnotations())
const setTool = (page, tool) =>
  page.evaluate(name => window.editor.setTool(name), tool)
const rounded = points => points.map(([x, y]) => [Math.round(x), Math.round(y)])

test("pen tool draws a thinned stroke", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "pen")
    await page.mouse.move(50, 50)
    await page.mouse.down()
    await page.mouse.move(150, 50, { steps: 5 })
    await page.mouse.move(150, 150, { steps: 5 })
    await page.mouse.up()

    const list = await annotations(page)
    assert.equal(list.length, 1)
    assert.equal(list[0].type, "pen")
    assert.deepEqual(rounded(list[0].points), [
      [50, 50],
      [150, 50],
      [150, 150],
    ])
    assert.equal(await page.locator("svg g[data-type=pen]").count(), 1)
  })
})

test("highlight tool draws a highlight", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "highlight")
    await drag(page, [20, 100], [200, 100])
    const list = await annotations(page)
    assert.equal(list.length, 1)
    assert.equal(list[0].type, "highlight")
    assert.deepEqual(rounded(list[0].points), [
      [20, 100],
      [200, 100],
    ])
  })
})

test("callout tool creates a note at the click, focused for typing", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "callout")
    await page.mouse.click(100, 200)

    let [callout] = await annotations(page)
    assert.equal(callout.type, "callout")
    assert.deepEqual(callout.anchor, [100, 200])
    assert.deepEqual(callout.box, { x: 140, y: 90, w: 220, h: 68 })

    const focused = await page.evaluate(() =>
      document.activeElement.getAttribute("data-role"),
    )
    assert.equal(focused, "text")
    const font = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement)
      return [style.fontSize, style.lineHeight]
    })
    assert.deepEqual(font, ["20px", "26px"])

    await page.keyboard.type("Hello")
    ;[callout] = await annotations(page)
    assert.equal(callout.text, "Hello")

    await page.evaluate(() => document.activeElement.blur())
    ;[callout] = await annotations(page)
    assert.equal(callout.text, "Hello")
  })
})

test("select tool moves a stroke", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "pen")
    await drag(page, [50, 50], [150, 50])
    await setTool(page, "select")
    await drag(page, [100, 50], [100, 100])
    const [stroke] = await annotations(page)
    assert.deepEqual(rounded(stroke.points), [
      [50, 100],
      [150, 100],
    ])
    assert.equal(
      await page.evaluate(() => window.editor.getSelectedId()),
      stroke.id,
    )
  })
})

test("select tool moves a callout box, its anchor, and resizes it", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "callout")
    await page.mouse.click(100, 200)
    await page.evaluate(() => document.activeElement.blur())
    await setTool(page, "select")

    await drag(page, [142, 92], [162, 112])
    let [callout] = await annotations(page)
    assert.deepEqual(callout.box, { x: 160, y: 110, w: 220, h: 68 })
    assert.deepEqual(callout.anchor, [100, 200])

    await drag(page, [100, 200], [120, 220])
    ;[callout] = await annotations(page)
    assert.deepEqual(callout.anchor, [120, 220])

    // The handle changes the width; the height always fits the text.
    await drag(page, [374, 172], [354, 182])
    ;[callout] = await annotations(page)
    assert.deepEqual(callout.box, { x: 160, y: 110, w: 200, h: 68 })
  })
})

const textBox = page =>
  page.evaluate(() => {
    const div = document.querySelector("[data-role=text]")
    return { scrollHeight: div.scrollHeight, clientHeight: div.clientHeight }
  })

test("typing more lines than fit grows the callout box so nothing is clipped", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "callout")
    await page.mouse.click(100, 200)
    await page.keyboard.type("one\ntwo\nthree\nfour")
    const [callout] = await annotations(page)
    assert.equal(callout.text, "one\ntwo\nthree\nfour")
    assert.equal(callout.box.h, 120)
    const box = await textBox(page)
    assert.ok(box.scrollHeight <= box.clientHeight, JSON.stringify(box))
  })
})

test("long text wraps in the editor and the static renderer breaks the same lines", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "callout")
    await page.mouse.click(100, 200)
    await page.keyboard.type(
      "The quick brown fox jumps over the lazy dog while the editor keeps every word visible inside the box.",
    )
    const [callout] = await annotations(page)
    const box = await textBox(page)
    assert.ok(box.scrollHeight <= box.clientHeight, JSON.stringify(box))
    const staticLines = await page.evaluate(shape => {
      const svg = window.harness.toSvgString(
        window.harness.renderTree([shape], { width: 400, height: 300 }),
      )
      return svg.match(/<tspan/g).length
    }, callout)
    assert.ok(staticLines >= 4, `wrapped into ${staticLines} lines`)
    assert.equal(staticLines * 26, box.scrollHeight)
    assert.equal(callout.box.h, staticLines * 26 + 16)
  })
})

test("delete key removes the selected shape and undo restores it", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "pen")
    await drag(page, [50, 50], [150, 50])
    await setTool(page, "select")
    await page.mouse.click(100, 50)
    await page.keyboard.press("Delete")
    assert.equal((await annotations(page)).length, 0)

    await page.evaluate(() => window.editor.undo())
    assert.equal((await annotations(page)).length, 1)

    await page.evaluate(() => window.editor.undo())
    assert.equal((await annotations(page)).length, 0)

    await page.evaluate(() => window.editor.undo())
    assert.equal((await annotations(page)).length, 0)
  })
})

test("clicking empty space deselects and onChange fires on commits", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "pen")
    await drag(page, [50, 50], [150, 50])
    await setTool(page, "select")
    await page.mouse.click(100, 50)
    assert.notEqual(
      await page.evaluate(() => window.editor.getSelectedId()),
      null,
    )
    await page.mouse.click(300, 250)
    assert.equal(await page.evaluate(() => window.editor.getSelectedId()), null)
    const changes = await page.evaluate(() => window.changes.length)
    assert.equal(changes, 1)
  })
})

test("switching tools while editing callout text does not throw and keeps the text", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "callout")
    await page.mouse.click(100, 200)
    await page.keyboard.type("Hi")

    const firstError = await page.evaluate(() => {
      try {
        window.editor.setTool("select")
        return null
      } catch (error) {
        return error.message
      }
    })
    assert.equal(firstError, null)

    const [callout] = await annotations(page)
    assert.equal(callout.text, "Hi")

    const secondError = await page.evaluate(() => {
      try {
        window.editor.setTool("pen")
        return null
      } catch (error) {
        return error.message
      }
    })
    assert.equal(secondError, null)
  })
})

test("strokes are clamped to the image", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "pen")
    await drag(page, [380, 20], [430, 20])
    const [stroke] = await annotations(page)
    assert.ok(stroke.points.every(([x]) => x <= 400))
    const [lastX, lastY] = stroke.points[stroke.points.length - 1]
    assert.deepEqual([Math.round(lastX), Math.round(lastY)], [400, 20])
  })
})

test("moving a stroke stops at the image edge", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "pen")
    await drag(page, [50, 50], [150, 50])
    await setTool(page, "select")
    await drag(page, [100, 50], [400, 50])
    const [stroke] = await annotations(page)
    assert.deepEqual(rounded(stroke.points), [
      [300, 50],
      [400, 50],
    ])
  })
})

test("pointer positions scale to image pixels when the image is shrunk", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/editor.html?scale=half`)
    await page.waitForFunction(() => window.editorReady === true)
    const box = await page.locator("#editor img").boundingBox()
    assert.equal(Math.round(box.width), 200)
    assert.equal(Math.round(box.height), 150)
    await setTool(page, "pen")
    await drag(page, [25, 25], [75, 25])
    const [stroke] = await annotations(page)
    assert.deepEqual(rounded(stroke.points), [
      [50, 50],
      [150, 50],
    ])
  })
})

test("a second pointer does not disturb a pen stroke in progress", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "pen")
    await page.mouse.move(50, 50)
    await page.mouse.down()
    await page.mouse.move(100, 50, { steps: 4 })

    await page.evaluate(() => {
      const svg = document.querySelector(".harness-annotator-svg")
      const fire = (type, x, y) =>
        svg.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 2,
            pointerType: "touch",
            isPrimary: false,
            button: type === "pointermove" ? -1 : 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        )
      fire("pointerdown", 200, 200)
      fire("pointermove", 220, 250)
      fire("pointerup", 220, 250)
    })

    await page.mouse.move(150, 50, { steps: 4 })
    await page.mouse.up()

    const list = await annotations(page)
    assert.equal(list.length, 1)
    assert.deepEqual(rounded(list[0].points), [
      [50, 50],
      [150, 50],
    ])
  })
})

test("undo while callout text is dirty records the edit once", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "callout")
    await page.mouse.click(100, 200)
    await page.keyboard.type("Hi")

    await page.evaluate(() => window.editor.undo())
    let list = await annotations(page)
    assert.equal(list.length, 1)
    assert.equal(list[0].text, "")

    await page.evaluate(() => window.editor.undo())
    assert.deepEqual(await annotations(page), [])
  })
})

test("deleteSelected while callout text is dirty can be undone in one step", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "callout")
    await page.mouse.click(100, 200)
    await page.keyboard.type("Hi")

    await page.evaluate(() => window.editor.deleteSelected())
    assert.deepEqual(await annotations(page), [])

    await page.evaluate(() => window.editor.undo())
    const list = await annotations(page)
    assert.equal(list.length, 1)
    assert.equal(list[0].text, "Hi")
  })
})

const selectedIds = page => page.evaluate(() => window.editor.getSelectedIds())

// Three pen strokes: A and B are short; C is long and reaches x = 250.
async function drawThreeStrokes(page) {
  await setTool(page, "pen")
  await drag(page, [50, 50], [100, 50])
  await drag(page, [50, 100], [100, 100])
  await drag(page, [50, 150], [250, 150])
  await setTool(page, "select")
  return (await annotations(page)).map(shape => shape.id)
}

async function withKey(page, key, fn) {
  await page.keyboard.down(key)
  await fn()
  await page.keyboard.up(key)
}

test("a marquee selects shapes fully inside it and not one partly outside", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    const [a, b] = await drawThreeStrokes(page)
    await drag(page, [30, 30], [150, 200])
    assert.deepEqual(await selectedIds(page), [a, b])
    assert.equal(await page.evaluate(() => window.editor.getSelectedId()), a)
    assert.equal(await page.locator('svg [data-role="selection"]').count(), 2)
    assert.equal(await page.locator('svg [data-role="marquee"]').count(), 0)
  })
})

test("the marquee is drawn while dragging and ignores pointer events", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await drawThreeStrokes(page)
    await page.mouse.move(30, 30)
    await page.mouse.down()
    await page.mouse.move(150, 200, { steps: 4 })
    const marquee = page.locator('svg [data-role="marquee"]')
    assert.equal(await marquee.count(), 1)
    assert.equal(await marquee.getAttribute("pointer-events"), "none")
    assert.equal(await marquee.getAttribute("width"), "120")
    await page.mouse.up()
  })
})

test("shift+marquee adds to the selection and ctrl+marquee toggles", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    const [a, b] = await drawThreeStrokes(page)
    await drag(page, [30, 30], [150, 70])
    assert.deepEqual(await selectedIds(page), [a])
    await withKey(page, "Shift", () => drag(page, [30, 80], [150, 120]))
    assert.deepEqual(await selectedIds(page), [a, b])
    // A plain marquee replaces the selection.
    await drag(page, [30, 80], [150, 120])
    assert.deepEqual(await selectedIds(page), [b])
    // Ctrl toggles each hit shape: A on, B off.
    await withKey(page, "Control", () => drag(page, [30, 30], [150, 120]))
    assert.deepEqual(await selectedIds(page), [a])
  })
})

test("shift+click adds and ctrl+click toggles without dragging", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    const [a, b, c] = await drawThreeStrokes(page)
    await page.mouse.click(75, 50)
    assert.deepEqual(await selectedIds(page), [a])
    await withKey(page, "Shift", () => page.mouse.click(200, 150))
    assert.deepEqual(await selectedIds(page), [a, c])
    await withKey(page, "Control", () => page.mouse.click(75, 100))
    assert.deepEqual(await selectedIds(page), [a, c, b])

    // Ctrl-pressing a selected shape deselects it and does not move it.
    await withKey(page, "Control", () => drag(page, [75, 50], [75, 90]))
    assert.deepEqual(await selectedIds(page), [c, b])
    const [strokeA] = await annotations(page)
    assert.deepEqual(rounded(strokeA.points), [
      [50, 50],
      [100, 50],
    ])

    // A plain click on an unselected shape selects only it.
    await page.mouse.click(75, 50)
    assert.deepEqual(await selectedIds(page), [a])
  })
})

test("dragging one selected shape moves the whole selection by the same delta", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    const [a, b] = await drawThreeStrokes(page)
    await drag(page, [30, 30], [150, 120])
    await page.mouse.click(75, 50)
    assert.deepEqual(await selectedIds(page), [a, b])

    await drag(page, [75, 50], [95, 80])
    const [strokeA, strokeB, strokeC] = await annotations(page)
    assert.deepEqual(rounded(strokeA.points), [
      [70, 80],
      [120, 80],
    ])
    assert.deepEqual(rounded(strokeB.points), [
      [70, 130],
      [120, 130],
    ])
    assert.deepEqual(rounded(strokeC.points), [
      [50, 150],
      [250, 150],
    ])
    assert.deepEqual(await selectedIds(page), [a, b])
    assert.equal(await page.evaluate(() => window.changes.length), 4)
  })
})

test("a group drag stops when any selected shape reaches the image edge", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await drawThreeStrokes(page)
    await page.mouse.click(75, 50)
    await withKey(page, "Shift", () => page.mouse.click(200, 150))
    // C's right end is at 250, so the group can move right by at most 150.
    await drag(page, [75, 50], [400, 50])
    const [strokeA, , strokeC] = await annotations(page)
    assert.deepEqual(rounded(strokeA.points), [
      [200, 50],
      [250, 50],
    ])
    assert.deepEqual(rounded(strokeC.points), [
      [200, 150],
      [400, 150],
    ])
  })
})

test("a callout box drag moves only that callout's box, even in a group", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "pen")
    await drag(page, [20, 280], [60, 280])
    await setTool(page, "callout")
    await page.mouse.click(100, 200)
    await page.evaluate(() => document.activeElement.blur())
    await setTool(page, "select")
    await page.mouse.click(40, 280)
    await withKey(page, "Shift", () => page.mouse.click(143, 120))
    assert.equal((await selectedIds(page)).length, 2)

    await drag(page, [143, 120], [153, 130])
    const [stroke, callout] = await annotations(page)
    assert.deepEqual(rounded(stroke.points), [
      [20, 280],
      [60, 280],
    ])
    assert.deepEqual(callout.anchor, [100, 200])
    assert.equal(callout.box.x, 150)
  })
})

test("delete removes every selected shape in one undoable step", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    const [, , c] = await drawThreeStrokes(page)
    await drag(page, [30, 30], [150, 120])
    await page.keyboard.press("Delete")
    const list = await annotations(page)
    assert.deepEqual(
      list.map(shape => shape.id),
      [c],
    )
    assert.deepEqual(await selectedIds(page), [])
    await page.evaluate(() => window.editor.undo())
    assert.equal((await annotations(page)).length, 3)
  })
})

test("placing a note switches back to the select tool", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "callout")
    assert.deepEqual(await page.evaluate(() => window.toolChanges), [])
    await page.mouse.click(100, 200)
    assert.equal(await page.evaluate(() => window.editor.getTool()), "select")
    assert.deepEqual(await page.evaluate(() => window.toolChanges), ["select"])
    assert.equal(
      await page.locator(".harness-annotator-svg").getAttribute("data-tool"),
      "select",
    )
    assert.equal((await selectedIds(page)).length, 1)

    await page.mouse.click(30, 280)
    assert.equal((await annotations(page)).length, 1)
    assert.deepEqual(await selectedIds(page), [])
  })
})

test("redo reapplies an undone change and the editor leaves Ctrl+Z to its host", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "pen")
    await drag(page, [50, 50], [150, 50])
    await page.keyboard.press("Control+z")
    assert.equal((await annotations(page)).length, 1)

    await page.evaluate(() => window.editor.undo())
    assert.equal((await annotations(page)).length, 0)
    await page.evaluate(() => window.editor.redo())
    const list = await annotations(page)
    assert.equal(list.length, 1)
    assert.deepEqual(rounded(list[0].points), [
      [50, 50],
      [150, 50],
    ])
    assert.equal((await page.evaluate(() => window.changes)).length, 3)
    await page.evaluate(() => window.editor.redo())
    assert.equal((await annotations(page)).length, 1)
  })
})

test("lost pointer capture discards the draft so the editor keeps working", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "pen")
    await page.mouse.move(50, 50)
    await page.mouse.down()
    await page.mouse.move(100, 50, { steps: 4 })
    await page.evaluate(() => {
      const svg = document.querySelector(".harness-annotator-svg")
      svg.dispatchEvent(
        new PointerEvent("lostpointercapture", { pointerId: 1, bubbles: true }),
      )
    })
    await page.mouse.up()
    assert.equal(await page.locator("svg g[data-type=pen]").count(), 0)

    await drag(page, [50, 200], [150, 200])
    const list = await annotations(page)
    assert.equal(list.length, 1)
    assert.deepEqual(rounded(list[0].points), [
      [50, 200],
      [150, 200],
    ])
  })
})

test("a mixed group drag keeps a selected callout inside the image", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "pen")
    await drag(page, [20, 280], [60, 280])
    await setTool(page, "callout")
    await page.mouse.click(100, 200)
    await page.evaluate(() => document.activeElement.blur())
    // Callout box: x 140..360, so it can move right by at most 40, while the
    // stroke alone could move by 340.
    await page.mouse.click(40, 280)
    await withKey(page, "Shift", () => page.mouse.click(143, 120))
    assert.equal((await selectedIds(page)).length, 2)

    await drag(page, [40, 280], [300, 280])
    const [stroke, callout] = await annotations(page)
    assert.ok(callout.box.x + callout.box.w <= 400, JSON.stringify(callout))
    assert.equal(callout.box.x, 180)
    assert.deepEqual(callout.anchor, [140, 200])
    assert.deepEqual(rounded(stroke.points), [
      [60, 280],
      [100, 280],
    ])
  })
})

test("lost pointer capture during a move puts the shape back", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await openEditor(page, baseUrl)
    await setTool(page, "pen")
    await drag(page, [50, 50], [150, 50])
    await setTool(page, "select")
    await page.mouse.move(100, 50)
    await page.mouse.down()
    await page.mouse.move(100, 120, { steps: 4 })
    await page.evaluate(() => {
      const svg = document.querySelector(".harness-annotator-svg")
      svg.dispatchEvent(
        new PointerEvent("lostpointercapture", { pointerId: 1, bubbles: true }),
      )
    })
    await page.mouse.up()
    const [stroke] = await annotations(page)
    assert.deepEqual(rounded(stroke.points), [
      [50, 50],
      [150, 50],
    ])
    assert.equal(await page.evaluate(() => window.changes.length), 1)
  })
})
