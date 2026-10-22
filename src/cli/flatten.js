// Flattens annotations onto a screenshot from the command line. The overlay
// is the same static SVG the inbox draws. ImageMagick composites it onto the
// raw image when installed; otherwise Playwright's Chromium renders the two
// stacked, when it is installed (it is in the dev container). Either way the
// raw image is drawn at CSS pixels, because the capture is scaled by the
// device pixel ratio while the overlay is drawn in CSS pixels.
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
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

// Draws the raw image and the overlay on top of each other in headless
// Chromium and screenshots the result. Returns false when Playwright is not
// installed.
export async function renderWithPlaywright({
  raw,
  overlay,
  out,
  width,
  height,
}) {
  let playwright
  try {
    playwright = await import("playwright")
  } catch {
    return false
  }
  const dataUrl = async (file, type) =>
    `data:${type};base64,${(await readFile(file)).toString("base64")}`
  const layer = src =>
    `<img src="${src}" style="position:absolute;left:0;top:0;width:${width}px;height:${height}px">`
  const html =
    `<!doctype html><html><body style="margin:0;background:#fff">` +
    layer(await dataUrl(raw, "image/webp")) +
    layer(await dataUrl(overlay, "image/svg+xml")) +
    `</body></html>`
  const browser = await playwright.chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    })
    await page.setContent(html, { waitUntil: "load" })
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } })
  } finally {
    await browser.close()
  }
  return true
}

// Returns a flatten function that resolves with the output path, or null
// when nothing can render, in which case `unavailable` says so.
export function createFlattener({
  run = execute,
  render = renderWithPlaywright,
} = {}) {
  let tool = null
  const flatten = async spec => {
    const tools =
      tool && tool !== "playwright" ? [tool] : tool ? [] : CANDIDATES
    for (const candidate of tools) {
      try {
        await run(flattenCommand(spec, candidate))
        tool = candidate
        return spec.out
      } catch {
        // Try the next command.
      }
    }
    try {
      if (await render(spec)) {
        tool = "playwright"
        return spec.out
      }
    } catch (error) {
      flatten.unavailable = `Rendering the annotated PNG failed: ${error.message}`
      return null
    }
    flatten.unavailable =
      "Neither ImageMagick (magick or convert) nor Playwright is available, so no annotated PNGs were written; the overlay SVGs are next to the raw screenshots."
    return null
  }
  return flatten
}
