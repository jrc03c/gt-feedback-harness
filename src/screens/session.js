import { withDeveloper } from "./developer.js"
import { formatDate, formatLines } from "../format.js"
import { renderProgramHeading } from "./heading.js"
import { renderTree, toDom } from "../annotations/render.js"
import { flattenToPng } from "../annotations/flatten.js"
import { download } from "../download.js"

export async function mountSession({ root, store, sessionId }) {
  await withDeveloper({
    root,
    store,
    render: async () => {
      const [session, items] = await Promise.all([
        store.getSession(sessionId),
        store.listItems(sessionId),
      ])
      const program = {
        label: session.programs.label,
        gt_key: session.programs.gt_key,
      }
      root.innerHTML = `
        <main class="harness-home harness-session">
          <p><a></a></p>
          <h1></h1>
          <p class="harness-session-meta"></p>
          <section class="harness-items"></section>
          <dialog class="harness-lightbox">
            <p class="harness-lightbox-actions">
              <button type="button" data-action="open-tab">Open in new tab</button>
              <button type="button" data-action="close">Close</button>
            </p>
            <div class="harness-lightbox-scroll"><div class="harness-lightbox-image"></div></div>
            <p class="harness-error" hidden></p>
          </dialog>
        </main>`
      const back = root.querySelector("a")
      back.href = `?dev&program=${encodeURIComponent(session.program_id)}`
      back.textContent = "Back to the inbox"
      renderProgramHeading(root.querySelector("h1"), program)
      root.querySelector(".harness-session-meta").textContent =
        `${session.reviewer_name || "Anonymous"}, ${session.mode} mode, started ${formatDate(session.started_at)}`
      const list = root.querySelector(".harness-items")
      if (items.length === 0) {
        const empty = document.createElement("p")
        empty.textContent = "No feedback was sent in this session."
        list.appendChild(empty)
      }
      const lightbox = createLightbox(root.querySelector(".harness-lightbox"))
      const cards = await Promise.all(
        items.map(item => itemCard(item, program, store, lightbox)),
      )
      for (const card of cards) list.appendChild(card)
    },
  })
}

// One dialog per session view, refilled for whichever screenshot was clicked.
// The image shows at its stored size and scrolls if it is bigger than the
// window; "Open in new tab" flattens it to a PNG, which the browser can then
// zoom and save like any other image.
function createLightbox(dialog) {
  const imageBox = dialog.querySelector(".harness-lightbox-image")
  const errorBox = dialog.querySelector(".harness-error")
  const openTab = dialog.querySelector('[data-action="open-tab"]')
  let current = null
  let tabUrl = null

  dialog
    .querySelector('[data-action="close"]')
    .addEventListener("click", () => dialog.close())
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close()
  })
  openTab.addEventListener("click", async () => {
    if (!current) return
    openTab.disabled = true
    errorBox.hidden = true
    try {
      const png = await flattenToPng(current)
      if (tabUrl) URL.revokeObjectURL(tabUrl)
      tabUrl = URL.createObjectURL(png)
      window.open(tabUrl, "_blank")
    } catch (error) {
      errorBox.textContent = `Could not build the PNG: ${error.message}`
      errorBox.hidden = false
    } finally {
      openTab.disabled = false
    }
  })

  return {
    open({ imageUrl, imageSize, annotations }) {
      current = { imageUrl, imageSize, annotations }
      errorBox.hidden = true
      const img = document.createElement("img")
      img.src = imageUrl
      img.width = imageSize.width
      img.height = imageSize.height
      img.alt = "Screenshot"
      imageBox.style.width = `${imageSize.width}px`
      imageBox.style.height = `${imageSize.height}px`
      imageBox.replaceChildren(
        img,
        toDom(renderTree(annotations, imageSize, { mode: "static" })),
      )
      dialog.showModal()
    },
  }
}

async function itemCard(item, program, store, lightbox) {
  const card = document.createElement("article")
  card.className = "harness-item"
  card.classList.toggle("harness-resolved", Boolean(item.resolved_at))
  card.innerHTML = `
    <p class="harness-item-when"></p>
    <figure class="harness-item-figure">
      <div class="harness-item-image"></div>
      <figcaption><pre class="harness-item-text"></pre></figcaption>
    </figure>
    <details><summary>Context</summary><dl></dl></details>
    <p class="harness-item-actions">
      <button type="button" data-action="resolve"></button>
      <button type="button" data-action="download">Download PNG</button>
    </p>
    <p class="harness-error" hidden></p>`
  const errorBox = card.querySelector(".harness-error")
  const downloadButton = card.querySelector('[data-action="download"]')
  downloadButton.hidden = !item.screenshot_path
  card.querySelector(".harness-item-when").textContent = formatDate(
    item.created_at,
  )
  card.querySelector(".harness-item-text").textContent =
    item.text || "(no text)"

  const size = item.image_size || { width: 800, height: 600 }
  let imageUrl = null
  if (item.screenshot_path) {
    try {
      const blob = await store.downloadScreenshot(item.screenshot_path)
      imageUrl = URL.createObjectURL(blob)
      const img = document.createElement("img")
      img.src = imageUrl
      img.width = size.width
      img.height = size.height
      img.alt = "Screenshot"
      const wrap = card.querySelector(".harness-item-image")
      wrap.appendChild(img)
      wrap.appendChild(
        toDom(renderTree(item.annotations || [], size, { mode: "static" })),
      )
      wrap.title = "Click to view full size"
      wrap.tabIndex = 0
      wrap.setAttribute("role", "button")
      const show = () =>
        lightbox.open({
          imageUrl,
          imageSize: size,
          annotations: item.annotations || [],
        })
      wrap.addEventListener("click", show)
      wrap.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          show()
        }
      })
    } catch (error) {
      card.querySelector(".harness-item-image").textContent =
        `Screenshot unavailable: ${error.message}`
      downloadButton.hidden = true
    }
  }

  const dl = card.querySelector("dl")
  const context = item.context || {}
  const rows = [
    ["Lines", formatLines(context.lines)],
    ["Run id", context.runId || ""],
    ["Program", context.programName || ""],
    ["Node", context.nodeId || ""],
    [
      "Viewport",
      context.viewport
        ? `${context.viewport.width} x ${context.viewport.height}`
        : "",
    ],
    ["Browser", context.userAgent || ""],
    ["Captured", context.capturedAt ? formatDate(context.capturedAt) : ""],
  ]
  for (const [name, value] of Object.entries(context.variables || {}))
    rows.push([`Variable ${name}`, JSON.stringify(value)])
  if (context.variablesTruncated)
    rows.push(["Variables", "truncated at 100 KB"])
  for (const [term, value] of rows) {
    const dt = document.createElement("dt")
    const dd = document.createElement("dd")
    dt.textContent = term
    dd.textContent = value
    dl.append(dt, dd)
  }

  const resolveButton = card.querySelector('[data-action="resolve"]')
  const labelResolve = () =>
    (resolveButton.textContent = item.resolved_at
      ? "Mark unresolved"
      : "Mark resolved")
  labelResolve()
  resolveButton.addEventListener("click", async () => {
    const next = !item.resolved_at
    resolveButton.disabled = true
    errorBox.hidden = true
    try {
      await store.setResolved(item.id, next)
      item.resolved_at = next ? new Date().toISOString() : null
      card.classList.toggle("harness-resolved", next)
      labelResolve()
    } catch (error) {
      errorBox.textContent = `Could not update the item: ${error.message}`
      errorBox.hidden = false
    } finally {
      resolveButton.disabled = false
    }
  })

  downloadButton.addEventListener("click", async () => {
    if (!imageUrl) return
    downloadButton.disabled = true
    errorBox.hidden = true
    try {
      const png = await flattenToPng({
        imageUrl,
        imageSize: size,
        annotations: item.annotations || [],
      })
      download(png, `feedback-${program.gt_key}-${item.id}.png`)
    } catch (error) {
      errorBox.textContent = `Could not build the PNG: ${error.message}`
      errorBox.hidden = false
    } finally {
      downloadButton.disabled = false
    }
  })
  return card
}
