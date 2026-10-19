import { test } from "node:test"
import assert from "node:assert/strict"
import {
  renderTree,
  toSvgString,
  wrapText,
  fitCallout,
  calloutHeight,
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

test("strokes with three or more points render as smooth curves", () => {
  const curve = {
    id: "p2",
    type: "pen",
    points: [
      [0, 0],
      [6, 6],
      [12, 0],
    ],
  }
  const svg = toSvgString(renderTree([curve], image, { mode: "live" }))
  const d = 'd="M 0 0 C 1 1 4 6 6 6 C 8 6 11 1 12 0"'
  // Both the visible path and the hit path use the curve.
  assert.equal(svg.split(d).length - 1, 2)
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
  // The stored 40px box is refitted to its three wrapped lines.
  assert.ok(svg.includes('<rect x="10" y="40" width="100" height="94"'), svg)
  assert.ok(svg.includes("<text "))
  assert.ok(svg.includes("<tspan"))
  assert.ok(!svg.includes("foreignObject"))
})

test("static callout text is 20px with 26px lines", () => {
  const svg = toSvgString(renderTree([callout], image))
  // Box text starts at y = 40 + 8 padding + 20 font size.
  assert.ok(svg.includes('<text x="18" y="68" font-size="20"'), svg)
  assert.ok(svg.includes('<tspan x="18" dy="26">world</tspan>'), svg)
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
  // 20px * 0.55 = 11px per character, so 60px holds 5 characters.
  assert.deepEqual(wrapText("abcdefghijkl", 60), ["abcde", "fghij", "kl"])
  assert.deepEqual(wrapText("abcdefghijkl", 60, 14), ["abcdefg", "hijkl"])
})

test("wrapText uses the measure function when one is given", () => {
  const measure = text => text.length * 10
  assert.deepEqual(wrapText("hello world foo", 55, 20, measure), [
    "hello",
    "world",
    "foo",
  ])
  assert.deepEqual(wrapText("ab cd", 50, 20, measure), ["ab cd"])
  assert.deepEqual(wrapText("abcdefg", 30, 20, measure), ["abc", "def", "g"])
})

test("calloutHeight fits the lines but never shrinks below the default box", () => {
  assert.equal(calloutHeight(1), 68)
  assert.equal(calloutHeight(2), 68)
  assert.equal(calloutHeight(3), 94)
})

test("fitCallout sets the box height to the wrapped text", () => {
  const tall = fitCallout({ ...callout, text: "a\nb\nc\nd" })
  assert.equal(tall.box.h, 120)
  assert.equal(fitCallout(callout).box.h, 94, "three wrapped lines")
  assert.equal(fitCallout({ ...callout, text: "hi" }).box.h, 68, "one line")
  assert.deepEqual(callout.box.h, 40, "the input is not mutated")
})

test("h builds a tree node", () => {
  assert.deepEqual(h("g", { id: "x" }, ["t"]), {
    tag: "g",
    attrs: { id: "x" },
    children: ["t"],
  })
})
