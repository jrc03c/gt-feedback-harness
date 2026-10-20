import { domToCanvas } from "modern-screenshot"

export const CHROME_SELECTOR = "[data-harness-chrome]"

// Elements that stall the capture: the composed SVG image never finishes
// loading while it contains one, so the library waits out its timeout and
// then draws nothing. Each is replaced in the clone by an empty box of the
// same size, so the rest of the page keeps its position.
export const MEDIA_SELECTOR = "audio, iframe, object, embed"

// After some partial relayouts (GuidedTrack showing its points change, an
// absolutely positioned box, is one) Chromium reports the used value of an
// auto margin as 0px although the element stays centred. The capture copies
// that value into its clone and draws the page shifted to the left. A full
// relayout from the root makes the reported values right again.
function forceRelayout(root) {
  const previous = root.style.getPropertyValue("padding-right")
  const priority = root.style.getPropertyPriority("padding-right")
  root.style.setProperty("padding-right", "0.5px", "important")
  void root.offsetWidth
  if (previous) root.style.setProperty("padding-right", previous, priority)
  else root.style.removeProperty("padding-right")
  void root.offsetWidth
}

// Drawn in place of an image whose server does not allow cross-origin reads
// (the capture must fetch every image to inline it). The SVG has no size of
// its own, so it fills whatever box the image had. See docs/backlog.md for
// the proxy that would show such images instead.
export const GRAY_BOX =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><rect width="100%" height="100%" fill="#eee"/></svg>',
  )

function replaceMedia(clone) {
  if (!clone.querySelectorAll) return
  for (const element of clone.querySelectorAll(MEDIA_SELECTOR)) {
    const box = clone.ownerDocument.createElement("div")
    box.setAttribute("style", element.getAttribute("style") || "")
    box.style.display = "inline-block"
    box.style.background = "#eee"
    element.replaceWith(box)
  }
}

// GuidedTrack serves its stylesheets without cross-origin headers, so the
// capture library cannot read their @font-face rules and would leave the icon
// fonts out. scripts/gt-fonts.mjs writes a copy of those rules, with the font
// files inlined, next to the deployed site; it is fetched once and handed to
// the library, which pastes it into the screenshot. Without the file the
// capture still works, only without GuidedTrack's icons.
export const FONTS_URL = "gt-fonts.css"
const fontCssCache = new Map()

export function loadFontCss(url) {
  if (!url) return Promise.resolve(null)
  if (!fontCssCache.has(url)) {
    fontCssCache.set(
      url,
      fetch(url)
        .then(response => (response.ok ? response.text() : ""))
        .then(text => (text.includes("@font-face") ? text : null))
        .catch(() => null),
    )
  }
  return fontCssCache.get(url)
}

export async function captureViewport({
  scale = Math.min(window.devicePixelRatio || 1, 2),
  exclude = CHROME_SELECTOR,
  quality = 0.85,
  fontsUrl = FONTS_URL,
} = {}) {
  const root = document.documentElement
  const fontCss = await loadFontCss(fontsUrl)
  forceRelayout(root)
  const full = await domToCanvas(root, {
    scale,
    backgroundColor: "#ffffff",
    width: root.scrollWidth,
    height: root.scrollHeight,
    filter: node => !(node instanceof Element && node.matches(exclude)),
    onCloneNode: replaceMedia,
    fetch: { placeholderImage: GRAY_BOX },
    font: fontCss ? { cssText: fontCss } : undefined,
  })

  const width = Math.round(window.innerWidth * scale)
  const height = Math.round(window.innerHeight * scale)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, width, height)
  context.drawImage(
    full,
    Math.round(window.scrollX * scale),
    Math.round(window.scrollY * scale),
    width,
    height,
    0,
    0,
    width,
    height,
  )

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      result =>
        result
          ? resolve(result)
          : reject(new Error("Could not encode screenshot")),
      "image/webp",
      quality,
    )
  })

  return { blob, url: URL.createObjectURL(blob), width, height, scale }
}
