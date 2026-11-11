// Test-only stand-in for getDisplayMedia: a canvas the size of the viewport,
// repainted every frame in a colour that says whether the harness chrome is
// hidden at that moment (green) or not (blue). Reading a screenshot's colour
// therefore tells whether the frame was taken while the chrome was hidden.
export function fakeDisplay({
  displaySurface = "browser",
  reject = false,
  chromeSelector = "[data-harness-chrome]",
} = {}) {
  const calls = []
  const canvas = document.createElement("canvas")
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  const context = canvas.getContext("2d")
  const paint = () => {
    const chrome = [...document.querySelectorAll(chromeSelector)]
    const hidden =
      chrome.length > 0 &&
      chrome.every(el => getComputedStyle(el).visibility === "hidden")
    context.fillStyle = hidden ? "#0c0" : "#00c"
    context.fillRect(0, 0, canvas.width, canvas.height)
    requestAnimationFrame(paint)
  }
  paint()
  const stream = canvas.captureStream(30)
  const [track] = stream.getVideoTracks()
  track.getSettings = () => ({ displaySurface })
  return {
    calls,
    track,
    getDisplayMedia: async constraints => {
      calls.push(constraints)
      if (reject) throw new DOMException("denied", "NotAllowedError")
      return stream
    },
  }
}

// Installs the fake as the page's real getDisplayMedia, the way the harness
// finds it when nothing is injected.
export function installFakeDisplay(options) {
  const fake = fakeDisplay(options)
  navigator.mediaDevices.getDisplayMedia = fake.getDisplayMedia
  window.fakeDisplayCalls = fake.calls
  return fake
}
