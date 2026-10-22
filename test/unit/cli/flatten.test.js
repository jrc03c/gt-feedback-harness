import { test } from "node:test"
import assert from "node:assert/strict"
import {
  overlaySvg,
  flattenCommand,
  createFlattener,
} from "../../../src/cli/flatten.js"

const size = { width: 800, height: 600 }
const annotations = [
  {
    id: "a",
    type: "pen",
    points: [
      [1, 2],
      [3, 4],
    ],
  },
  {
    id: "b",
    type: "callout",
    anchor: [10, 10],
    box: { x: 50, y: 50, w: 220, h: 68 },
    text: "Here",
  },
]

test("overlaySvg renders the annotations as a static svg the size of the image", () => {
  const svg = overlaySvg(annotations, size)
  assert.match(svg, /^<svg [^>]*viewBox="0 0 800 600"/)
  assert.match(svg, /data-mode="static"/)
  assert.match(svg, /<path /)
  assert.match(svg, /<text [^>]*>.*Here/)
  assert.doesNotMatch(svg, /foreignObject/)
})

test("flattenCommand resizes the raw screenshot to css pixels and composites the overlay", () => {
  assert.deepEqual(
    flattenCommand(
      {
        raw: "a.webp",
        overlay: "a.svg",
        out: "a.png",
        width: 800,
        height: 600,
      },
      "magick",
    ),
    ["magick", "a.webp", "-resize", "800x600!", "a.svg", "-composite", "a.png"],
  )
})

test("the flattener uses the first ImageMagick command that runs, and reports when none does", async () => {
  const runs = []
  const run = async argv => {
    runs.push(argv)
    if (argv[0] === "magick") throw new Error("ENOENT")
    return { ok: true }
  }
  const flatten = createFlattener({ run })
  const spec = {
    raw: "a.webp",
    overlay: "a.svg",
    out: "a.png",
    width: 8,
    height: 6,
  }
  assert.equal(await flatten(spec), "a.png")
  assert.deepEqual(
    runs.map(r => r[0]),
    ["magick", "convert"],
  )
  assert.equal(await flatten(spec), "a.png")
  assert.equal(runs.length, 3, "remembers which command worked")

  const none = createFlattener({
    run: async () => {
      throw new Error("ENOENT")
    },
  })
  assert.equal(await none(spec), null)
  assert.match(none.unavailable, /ImageMagick/)
})
