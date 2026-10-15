import { test } from "node:test"
import assert from "node:assert/strict"
import {
  renderTree,
  toSvgString,
  wrapText,
  h,
} from "../../src/annotations/render.js"

const image = { width: 400, height: 300 }
const pen = {
  id: "p1",
  type: "pen",
  points: [
    [0, 0],
    [10, 10],
  ],
}
const highlight = {
  id: "h1",
  type: "highlight",
  points: [
    [5, 5],
    [50, 5],
  ],
}
const callout = {
  id: "c1",
  type: "callout",
  anchor: [0, 50],
  box: { x: 10, y: 40, w: 100, h: 40 },
  text: "hello world foo",
}

test("root svg has xmlns, viewBox and size", () => {
  const svg = toSvgString(renderTree([], image))
  assert.ok(
    svg.startsWith(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300" data-mode="static">',
    ),
  )
  assert.ok(svg.includes('<marker id="harness-arrow"'))
})

test("static pen stroke is a single styled path", () => {
  const svg = toSvgString(renderTree([pen], image))
  assert.ok(svg.includes('<g data-id="p1" data-type="pen">'))
  assert.ok(svg.includes('d="M 0 0 L 10 10"'))
  assert.ok(svg.includes('stroke="#e53935"'))
  assert.ok(svg.includes('stroke-width="4"'))
  assert.ok(!svg.includes('data-role="shape"'), "static mode has no hit path")
})

test("live pen stroke adds a wide transparent hit path", () => {
  const svg = toSvgString(renderTree([pen], image, { mode: "live" }))
  assert.ok(svg.includes('stroke="transparent" stroke-width="16"'))
  assert.ok(svg.includes('data-role="shape"'))
})

test("highlight is translucent and multiplies", () => {
  const svg = toSvgString(renderTree([highlight], image))
  assert.ok(svg.includes('stroke="#ffeb3b"'))
  assert.ok(svg.includes('stroke-opacity="0.4"'))
  assert.ok(svg.includes("mix-blend-mode: multiply"))
})

test("static callout renders connector, anchor, box and wrapped text", () => {
  const svg = toSvgString(renderTree([callout], image))
  assert.ok(svg.includes('<line x1="10" y1="50" x2="0" y2="50"'))
  assert.ok(svg.includes('marker-end="url(#harness-arrow)"'))
  assert.ok(svg.includes('<circle cx="0" cy="50" r="6"'))
  assert.ok(svg.includes('<rect x="10" y="40" width="100" height="40"'))
  assert.ok(svg.includes("<text "))
  assert.ok(svg.includes("<tspan"))
  assert.ok(!svg.includes("foreignObject"))
})

test("static callout text is 16px with 20px lines", () => {
  const svg = toSvgString(renderTree([callout], image))
  // Box text starts at y = 40 + 8 padding + 16 font size.
  assert.ok(svg.includes('<text x="18" y="64" font-size="16"'), svg)
  assert.ok(svg.includes('<tspan x="18" dy="20">world foo</tspan>'), svg)
})

test("live callout renders an editable div and a resize handle", () => {
  const svg = toSvgString(renderTree([callout], image, { mode: "live" }))
  assert.ok(svg.includes("<foreignObject"))
  assert.ok(svg.includes('contenteditable="true"'))
  assert.ok(svg.includes('data-role="text"'))
  assert.ok(svg.includes('data-role="resize"'))
  assert.ok(svg.includes('data-role="anchor"'))
  assert.ok(svg.includes('data-role="box"'))
})

test("selected shape gets a selection outline and draft is drawn", () => {
  const svg = toSvgString(
    renderTree([pen], image, {
      mode: "live",
      selectedId: "p1",
      draft: highlight,
    }),
  )
  assert.ok(svg.includes('data-role="selection"'))
  assert.ok(svg.includes('data-id="h1"'))
})

test("every id in selectedIds gets an outline", () => {
  const svg = toSvgString(
    renderTree([pen, highlight, callout], image, {
      mode: "live",
      selectedIds: ["p1", "c1"],
    }),
  )
  assert.equal(svg.split('data-role="selection"').length - 1, 1)
  assert.ok(svg.includes('stroke-width="3" data-role="box"'))
  const highlightGroup = svg.slice(
    svg.indexOf('data-id="h1"'),
    svg.indexOf('data-id="c1"'),
  )
  assert.ok(!highlightGroup.includes('data-role="selection"'))
})

test("live mode draws the marquee as a normalised dashed rect", () => {
  const svg = toSvgString(
    renderTree([], image, {
      mode: "live",
      marquee: { start: [30, 40], end: [10, 5] },
    }),
  )
  assert.ok(
    svg.includes(
      '<rect x="10" y="5" width="20" height="35" fill="rgba(30, 136, 229, 0.1)" stroke="#1e88e5" stroke-dasharray="4 3" pointer-events="none" data-role="marquee">',
    ),
    svg,
  )
  const staticSvg = toSvgString(
    renderTree([], image, { marquee: { start: [0, 0], end: [5, 5] } }),
  )
  assert.ok(!staticSvg.includes("marquee"))
})

test("text content is escaped", () => {
  const svg = toSvgString(renderTree([{ ...callout, text: "<b>&" }], image))
  assert.ok(svg.includes("&lt;b&gt;&amp;"))
  assert.ok(!svg.includes("<b>"))
})

test("wrapText wraps greedily by estimated character width", () => {
  assert.deepEqual(wrapText("hello world foo", 60), ["hello", "world", "foo"])
  assert.deepEqual(wrapText("", 60), [""])
  assert.deepEqual(wrapText("a\nb", 60), ["a", "b"])
  // 16px * 0.55 = 8.8px per character, so 60px holds 6 characters.
  assert.deepEqual(wrapText("abcdefghijkl", 60), ["abcdef", "ghijkl"])
  assert.deepEqual(wrapText("abcdefghijkl", 60, 14), ["abcdefg", "hijkl"])
})

test("h builds a tree node", () => {
  assert.deepEqual(h("g", { id: "x" }, ["t"]), {
    tag: "g",
    attrs: { id: "x" },
    children: ["t"],
  })
})
