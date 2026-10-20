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

export async function captureViewport({
  scale = Math.min(window.devicePixelRatio || 1, 2),
  exclude = CHROME_SELECTOR,
  quality = 0.85,
} = {}) {
  const root = document.documentElement
  forceRelayout(root)
  const full = await domToCanvas(root, {
    scale,
    backgroundColor: "#ffffff",
    width: root.scrollWidth,
    height: root.scrollHeight,
    filter: node => !(node instanceof Element && node.matches(exclude)),
    onCloneNode: replaceMedia,
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
