import { createEditor, TOOLS } from "./annotations/editor.js"

export const TOOL_LABELS = {
  select: "Select",
  pen: "Pen",
  highlight: "Highlighter",
  callout: "Note",
}

export const HINTS = {
  select:
    "Click a mark to select it, or drag a box around several. Shift-click adds, Ctrl-click (Cmd-click on Mac) toggles. Drag to move. Delete removes.",
  pen: "Draw on the screenshot.",
  highlight: "Drag to highlight.",
  callout: "Click where the note should point.",
}

const ICONS = {
  select: "&#x2196;",
  pen: "&#x270F;",
  highlight: "&#x1F58D;",
  callout: "&#x1F4AC;",
  undo: "&#x21A9;",
  redo: "&#x21AA;",
  delete: "&#x1F5D1;",
}

function iconButton({ attr, key, label, extra = "" }) {
  return `<button type="button" ${attr}="${key}"${extra} aria-label="${label}"><span class="harness-icon" aria-hidden="true">${ICONS[key]}</span><span class="harness-label">${label}</span></button>`
}

export function openFeedbackModal({
  image,
  onSend,
  onCancel = () => {},
  root = document.body,
}) {
  const overlay = document.createElement("div")
  overlay.className = "harness-modal"
  overlay.setAttribute("data-harness-chrome", "")
  // Focusable so keyboard shortcuts reach its keydown listener.
  overlay.tabIndex = -1
  overlay.innerHTML = `
    <div class="harness-modal-dialog" role="dialog" aria-modal="true" aria-label="Give feedback">
      <div class="harness-toolbar">
        ${TOOLS.map(tool =>
          iconButton({
            attr: "data-tool",
            key: tool,
            label: TOOL_LABELS[tool],
            extra: ' aria-pressed="false"',
          }),
        ).join("")}
        <span class="harness-toolbar-spacer"></span>
        ${iconButton({ attr: "data-action", key: "undo", label: "Undo" })}
        ${iconButton({ attr: "data-action", key: "redo", label: "Redo" })}
        ${iconButton({ attr: "data-action", key: "delete", label: "Delete" })}
      </div>
      <p class="harness-hint"></p>
      <div class="harness-editor"><div></div></div>
      <textarea class="harness-text" rows="3" placeholder="Anything else? Type your feedback here."></textarea>
      <p class="harness-error" hidden></p>
      <div class="harness-actions">
        <button type="button" data-action="cancel">Cancel</button>
        <button type="button" data-action="send" class="harness-primary">Send feedback</button>
      </div>
    </div>`
  root.appendChild(overlay)

  const editor = createEditor({
    container: overlay.querySelector(".harness-editor > div"),
    image,
    onToolChange: syncToolbar,
  })
  const hint = overlay.querySelector(".harness-hint")
  const error = overlay.querySelector(".harness-error")
  const sendButton = overlay.querySelector('[data-action="send"]')
  const textarea = overlay.querySelector(".harness-text")

  function setTool(tool) {
    editor.setTool(tool)
    syncToolbar(tool)
  }

  function syncToolbar(tool) {
    for (const button of overlay.querySelectorAll(
      ".harness-toolbar [data-tool]",
    )) {
      button.setAttribute("aria-pressed", String(button.dataset.tool === tool))
    }
    hint.textContent = HINTS[tool]
  }

  function close() {
    editor.destroy()
    overlay.remove()
  }

  for (const button of overlay.querySelectorAll(
    ".harness-toolbar [data-tool]",
  )) {
    button.addEventListener("click", () => setTool(button.dataset.tool))
  }
  overlay
    .querySelector('[data-action="undo"]')
    .addEventListener("click", () => editor.undo())
  overlay
    .querySelector('[data-action="redo"]')
    .addEventListener("click", () => editor.redo())
  overlay
    .querySelector('[data-action="delete"]')
    .addEventListener("click", () => editor.deleteSelected())
  const cancelButton = overlay.querySelector('[data-action="cancel"]')
  cancelButton.addEventListener("click", openConfirm)

  let confirm = null

  function openConfirm() {
    if (confirm || cancelButton.disabled) return
    confirm = document.createElement("div")
    confirm.className = "harness-confirm"
    confirm.setAttribute("role", "alertdialog")
    confirm.setAttribute("aria-modal", "true")
    confirm.setAttribute("aria-label", "Discard this feedback?")
    confirm.innerHTML = `
      <div class="harness-confirm-card">
        <p>Discard this feedback?</p>
        <div class="harness-actions">
          <button type="button" data-action="keep">Keep editing</button>
          <button type="button" data-action="discard" class="harness-danger">Discard</button>
        </div>
      </div>`
    confirm
      .querySelector('[data-action="keep"]')
      .addEventListener("click", closeConfirm)
    confirm
      .querySelector('[data-action="discard"]')
      .addEventListener("click", () => {
        closeConfirm()
        close()
        onCancel()
      })
    overlay.appendChild(confirm)
    confirm.querySelector('[data-action="keep"]').focus()
  }

  function closeConfirm() {
    if (!confirm) return
    confirm.remove()
    confirm = null
    overlay.focus({ preventScroll: true })
  }

  sendButton.addEventListener("click", async () => {
    sendButton.disabled = true
    cancelButton.disabled = true
    sendButton.textContent = "Sending…"
    error.hidden = true
    try {
      await onSend({
        annotations: editor.getAnnotations(),
        text: textarea.value.trim(),
      })
      close()
    } catch (failure) {
      error.textContent = `Could not send: ${failure.message}`
      error.hidden = false
      sendButton.disabled = false
      cancelButton.disabled = false
      sendButton.textContent = "Retry"
    }
  })

  function isTextEntry(target) {
    return target.tagName === "TEXTAREA" || target.isContentEditable
  }

  function onEscape() {
    const active = document.activeElement
    if (
      active &&
      (active === textarea || active.getAttribute("data-role") === "text")
    ) {
      // Leave the note or the feedback box but keep keyboard focus in the
      // modal.
      active.blur()
      overlay.focus({ preventScroll: true })
    } else if (editor.getTool() !== "select") setTool("select")
    else openConfirm()
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      if (confirm) closeConfirm()
      else onEscape()
      event.preventDefault()
      return
    }
    // The discard question is modal: no editing shortcuts behind it.
    if (confirm) return
    if (!(event.ctrlKey || event.metaKey) || isTextEntry(event.target)) return
    const key = event.key.toLowerCase()
    if (key === "z" && !event.shiftKey) editor.undo()
    else if ((key === "z" && event.shiftKey) || key === "y") editor.redo()
    else return
    event.preventDefault()
  }

  overlay.addEventListener("keydown", onKeyDown)

  setTool("pen")
  overlay.focus({ preventScroll: true })
  return { close, editor, element: overlay }
}
