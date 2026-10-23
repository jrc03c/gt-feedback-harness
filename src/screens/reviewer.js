import { mountProgram } from "../gt-embed.js"
import { createContextTracker } from "../context.js"
import { createControls } from "../controls.js"
import { captureViewport } from "../capture.js"
import { openFeedbackModal } from "../feedback-modal.js"
import {
  harnessPageUrl,
  renderRefusalBanner,
  renderErrorBanner,
} from "./banners.js"

export { harnessPageUrl, renderRefusalBanner, renderErrorBanner }

export const NAME_KEY = "harness:reviewer-name"

// sendFeedback(item) receives
//   { key, mode, image: { blob, url, width, height, scale }, annotations,
//     text, context, reviewerName }
// where image.blob is always a Blob (a PNG placeholder if capture failed).
// image.url is an object URL the harness revokes once sendFeedback resolves,
// so read the Blob, not the URL, after that.
export async function mountReviewer({
  root,
  route,
  sendFeedback,
  assetBase,
  storage = window.localStorage,
  capture = captureViewport,
}) {
  root.innerHTML = '<div class="harness-program"></div>'
  const programRoot = root.querySelector(".harness-program")

  let mounted
  try {
    mounted = await mountProgram({
      root: programRoot,
      key: route.key,
      mode: route.mode,
      assetBase,
      onRefused: () => renderRefusalBanner(programRoot),
    })
  } catch (error) {
    renderErrorBanner(
      programRoot,
      `Could not load GuidedTrack: ${error.message}`,
    )
    return
  }

  const context = createContextTracker(mounted.events)
  const controls = createControls({
    root,
    onFeedback: giveFeedback,
    name: {
      value: readName(storage),
      onChange: value => saveName(storage, value),
    },
  })

  async function giveFeedback() {
    const snapshot = context.snapshot()
    controls.setBusy(true)
    let image
    try {
      image = await capture()
    } catch (error) {
      console.error("[harness] capture failed", error)
      image = await placeholderImage()
    }
    controls.setBusy(false)

    openFeedbackModal({
      image,
      onSend: async ({ annotations, text }) => {
        await sendFeedback({
          key: route.key,
          mode: route.mode,
          image,
          annotations,
          text,
          context: snapshot,
          reviewerName: readName(storage),
        })
        URL.revokeObjectURL(image.url)
      },
      onCancel: () => URL.revokeObjectURL(image.url),
    })
  }
}

function readName(storage) {
  try {
    return storage.getItem(NAME_KEY) || ""
  } catch {
    return ""
  }
}

export function saveName(storage, value) {
  try {
    storage.setItem(NAME_KEY, value)
  } catch {
    // Private mode or blocked storage: the name simply isn't remembered.
  }
}

async function placeholderImage() {
  const canvas = document.createElement("canvas")
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  const context = canvas.getContext("2d")
  context.fillStyle = "#e0e0e0"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "#555"
  context.font = "16px sans-serif"
  context.fillText(
    "Screenshot unavailable. You can still type feedback below.",
    20,
    40,
  )
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      result => (result ? resolve(result) : reject(new Error("toBlob failed"))),
      "image/png",
    ),
  )
  return {
    blob,
    url: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
    scale: 1,
  }
}
