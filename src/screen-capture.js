import { captureViewport, CHROME_SELECTOR } from "./capture.js"

// Screenshots through the Screen Capture API, for reviewer links that carry
// capture=screen. The browser hands over the tab's real pixels, so nothing
// the DOM capture struggles with (cross-origin images, fixed elements,
// embedded frames) is a problem, at the price of a sharing prompt. The
// reviewer is asked once per page load; the stream is kept and reused until
// they stop sharing. Whenever the API is missing (phones), the prompt is
// refused, or the reviewer shares something other than this tab, the DOM
// capture is used instead, so a screenshot always comes back.

const FRAME_TIMEOUT = 500

function defaultGetDisplayMedia(constraints) {
  const devices = navigator.mediaDevices
  if (!devices || typeof devices.getDisplayMedia !== "function") return null
  return devices.getDisplayMedia(constraints)
}

const CONSTRAINTS = {
  video: { displaySurface: "browser" },
  audio: false,
  preferCurrentTab: true,
  selfBrowserSurface: "include",
  surfaceSwitching: "exclude",
  monitorTypeSurfaces: "exclude",
}

const isLive = stream =>
  stream && stream.getVideoTracks().some(track => track.readyState === "live")

function stop(stream) {
  for (const track of stream.getTracks()) track.stop()
}

// Resolves once the video has produced a new frame, or after a short wait
// when none arrives (a still tab repaints nothing).
function nextFrame(video) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, FRAME_TIMEOUT)
    if (typeof video.requestVideoFrameCallback !== "function") return
    video.requestVideoFrameCallback(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function playing(stream) {
  const video = document.createElement("video")
  video.muted = true
  video.srcObject = stream
  await video.play()
  if (!video.videoWidth) await nextFrame(video)
  return video
}

export function createScreenCapture({
  getDisplayMedia = defaultGetDisplayMedia,
  fallback = captureViewport,
  chromeSelector = CHROME_SELECTOR,
  quality = 0.85,
} = {}) {
  let stream = null

  async function share() {
    if (isLive(stream)) return stream
    stream = null
    if (!getDisplayMedia) return null
    const shared = await getDisplayMedia(CONSTRAINTS)
    if (!isLive(shared)) return null
    const [track] = shared.getVideoTracks()
    const { displaySurface } = track.getSettings()
    if (displaySurface !== "browser") {
      stop(shared)
      return null
    }
    stream = shared
    return stream
  }

  async function grab(shared) {
    const video = await playing(shared)
    const chrome = [...document.querySelectorAll(chromeSelector)]
    const previous = chrome.map(element => element.style.visibility)
    for (const element of chrome) element.style.visibility = "hidden"
    try {
      // Two frames: the first may have been composed before the hide.
      await nextFrame(video)
      await nextFrame(video)
      if (!video.videoWidth) throw new Error("No frame from the shared tab")
      const canvas = document.createElement("canvas")
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext("2d").drawImage(video, 0, 0)
      return canvas
    } finally {
      chrome.forEach((element, i) => (element.style.visibility = previous[i]))
      video.srcObject = null
    }
  }

  return async function captureScreen() {
    let canvas
    try {
      const shared = await share()
      if (!shared) return fallback()
      canvas = await grab(shared)
    } catch (error) {
      console.warn(
        "[harness] screen capture failed, using the DOM capture",
        error,
      )
      return fallback()
    }
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
    return {
      blob,
      url: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
      scale: canvas.width / window.innerWidth,
    }
  }
}

export const captureScreen = createScreenCapture()
