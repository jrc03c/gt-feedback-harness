import { withDeveloper } from "./developer.js"
import { formatDate, formatLines, programLabel } from "../format.js"
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
        </main>`
      const back = root.querySelector("a")
      back.href = `?dev&program=${encodeURIComponent(session.program_id)}`
      back.textContent = "Back to the inbox"
      root.querySelector("h1").textContent =
        `${programLabel(program)} (${program.gt_key})`
      root.querySelector(".harness-session-meta").textContent =
        `${session.reviewer_name || "Anonymous"}, ${session.mode} mode, started ${formatDate(session.started_at)}`
      const list = root.querySelector(".harness-items")
      if (items.length === 0) {
        const empty = document.createElement("p")
        empty.textContent = "No feedback was sent in this session."
        list.appendChild(empty)
      }
      const cards = await Promise.all(
        items.map(item => itemCard(item, program, store)),
      )
      for (const card of cards) list.appendChild(card)
    },
  })
}

async function itemCard(item, program, store) {
  const card = document.createElement("article")
  card.className = "harness-item"
  card.classList.toggle("harness-resolved", Boolean(item.resolved_at))
  card.innerHTML = `
    <p class="harness-item-when"></p>
    <div class="harness-item-image"></div>
    <pre class="harness-item-text"></pre>
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
    (resolveButton.textContent = item.resolved_at ? "Unresolve" : "Resolve")
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
