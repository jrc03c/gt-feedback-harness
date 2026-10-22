// Flattens annotations onto a screenshot from the command line. The overlay
// is the same static SVG the inbox draws; ImageMagick composites it onto the
// raw image, which is resized to CSS pixels first because the raw capture is
// scaled by the device pixel ratio while the overlay is drawn in CSS pixels.
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { renderTree, toSvgString } from "../annotations/render.js"

const CANDIDATES = ["magick", "convert"]

export function overlaySvg(annotations, imageSize) {
  return toSvgString(renderTree(annotations, imageSize, { mode: "static" }))
}

export function flattenCommand({ raw, overlay, out, width, height }, tool) {
  return [
    tool,
    raw,
    "-resize",
    `${width}x${height}!`,
    overlay,
    "-composite",
    out,
  ]
}

async function execute(argv) {
  await promisify(execFile)(argv[0], argv.slice(1))
}

// Returns a flatten function that resolves with the output path, or null
// when no ImageMagick command works, in which case `unavailable` says so.
export function createFlattener({ run = execute } = {}) {
  let tool = null
  const flatten = async spec => {
    const tools = tool ? [tool] : CANDIDATES
    for (const candidate of tools) {
      try {
        await run(flattenCommand(spec, candidate))
        tool = candidate
        return spec.out
      } catch {
        // Try the next command.
      }
    }
    flatten.unavailable =
      "ImageMagick (magick or convert) is not available, so no annotated PNGs were written; the overlay SVGs are next to the raw screenshots."
    return null
  }
  return flatten
}
