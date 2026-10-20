export const GT_ASSET_BASE = "https://www.guidedtrack.com/assets"
export const REFUSAL_TEXT = "This page is not set up to run this program."

const STYLESHEETS = ["bootstrap.css", "guidedtrack.css"]
const SCRIPTS = ["jquery_gt.js", "bootstrap.min.js", "gt_interpreter.js"]
const EVENTS = ["pageStart", "append", "pageEnd", "done", "trace"]

// Copied from GuidedTrack's app/views/programs/_program_container.html.erb,
// except data-recaptcha-site-key (and the stage-only data-host): the harness
// has no reCAPTCHA site key, so programs using *question: captcha will not
// work in the harness.
export function containerMarkup(key, mode) {
  const modeAttribute = mode === "test" ? ' data-mode="test"' : ""
  return `<div class="guidedtrack program_container" id="${escapeAttr(key)}" data-environment="production"${modeAttribute}>
  <div id="program_navigation" role="banner">
    <div id="back-button"></div>
    <div class="navigation_container" role="navigation"></div>
    <div id="run-menu" role="navigation"></div>
    <div class="points" role="complementary" aria-label="points" aria-live="assertive">
      <div class="total"></div>
      <div class="change"></div>
    </div>
  </div>
  <div class="maintain" role="status" aria-label="note" aria-live="polite"></div>
  <div class="main" role="main" aria-live="polite"></div>
</div>`
}

export function createEmitter() {
  const handlers = {}
  const off = (name, fn) => {
    handlers[name] = (handlers[name] || []).filter(handler => handler !== fn)
  }
  return {
    on(name, fn) {
      ;(handlers[name] ||= []).push(fn)
      return () => off(name, fn)
    },
    off,
    emit(name, ...args) {
      for (const fn of handlers[name] || []) fn(...args)
    },
  }
}

export async function mountProgram({
  root,
  key,
  mode = "run",
  assetBase = GT_ASSET_BASE,
  onRefused = () => {},
}) {
  const events = createEmitter()
  root.innerHTML = containerMarkup(key, mode)
  const container = root.querySelector(".program_container")

  const observer = new MutationObserver(() => {
    if (container.textContent.includes(REFUSAL_TEXT)) {
      observer.disconnect()
      onRefused()
    }
  })
  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  for (const file of STYLESHEETS) loadStylesheet(`${assetBase}/${file}`)

  await loadScript(`${assetBase}/${SCRIPTS[0]}`)
  relayEvents(events)
  for (const file of SCRIPTS.slice(1)) await loadScript(`${assetBase}/${file}`)

  return {
    container,
    events,
    unmount() {
      observer.disconnect()
    },
  }
}

function relayEvents(events) {
  const $ = window.jQuery
  for (const name of EVENTS) {
    $(window).on(`guidedtrack:${name}`, (_event, options) => {
      events.emit(
        name,
        options && options.detail !== undefined ? options.detail : options,
      )
    })
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = src
    script.async = false
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(script)
  })
}

function loadStylesheet(href) {
  if (document.querySelector(`link[href="${href}"]`)) return
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = href
  document.head.appendChild(link)
}

function escapeAttr(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
}
