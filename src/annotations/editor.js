import {
  CALLOUT_DEFAULTS,
  clampBox,
  clampPoint,
  clone,
  connector,
  createCallout,
  createHistory,
  createStroke,
  rectFromPoints,
  shapeBounds,
  thinPath,
  translateShape,
} from "./model.js"
import {
  RESIZE_SIZE,
  SVG_NS,
  TEXT_PADDING,
  fitCallout,
  renderTree,
  toDom,
} from "./render.js"

export const TOOLS = ["select", "pen", "highlight", "callout"]

function unionBounds(list) {
  const x = Math.min(...list.map(b => b.x))
  const y = Math.min(...list.map(b => b.y))
  const right = Math.max(...list.map(b => b.x + b.w))
  const bottom = Math.max(...list.map(b => b.y + b.h))
  return { x, y, w: right - x, h: bottom - y }
}

export function createEditor({
  container,
  image,
  annotations = [],
  onChange = () => {},
  // Called when the editor changes its own tool (after placing a note), not
  // when setTool() is called from outside.
  onToolChange = () => {},
}) {
  let state = clone(annotations)
  let tool = "select"
  // Ordered ids of the selected shapes; the first is getSelectedId().
  let selection = []
  let draft = null
  let drag = null
  // { start, end, startClient, mode } while a select-tool marquee is dragged.
  let marquee = null
  // The pointer that started the current draft or drag; others are ignored
  // so a second finger cannot corrupt a stroke.
  let activePointerId = null
  let textDirty = false
  const history = createHistory(state)

  container.classList.add("harness-annotator")
  container.innerHTML = ""
  container.tabIndex = 0

  const img = document.createElement("img")
  img.src = image.url
  img.width = image.width
  img.height = image.height
  img.alt = "Screenshot"
  img.draggable = false
  container.appendChild(img)

  const svg = document.createElementNS(SVG_NS, "svg")
  svg.classList.add("harness-annotator-svg")
  container.appendChild(svg)

  function render() {
    flushText()
    const tree = toDom(
      renderTree(state, image, {
        mode: "live",
        selectedIds: selection,
        draft,
        marquee,
      }),
    )
    svg.setAttribute("viewBox", tree.getAttribute("viewBox"))
    svg.setAttribute("data-tool", tool)
    svg.replaceChildren(...Array.from(tree.childNodes))
  }

  function toImagePoint(event) {
    const rect = svg.getBoundingClientRect()
    return [
      ((event.clientX - rect.left) * image.width) / rect.width,
      ((event.clientY - rect.top) * image.height) / rect.height,
    ]
  }

  function roleOf(target) {
    return target && target.getAttribute
      ? target.getAttribute("data-role")
      : null
  }

  function find(id) {
    return state.find(shape => shape.id === id)
  }

  function replace(shape) {
    state = state.map(existing => (existing.id === shape.id ? shape : existing))
  }

  function commit() {
    history.push(state)
    onChange(clone(state))
  }

  // Persist a pending contenteditable text edit into history without
  // triggering a render. render() calls this first so that replacing the
  // SVG's children never removes a focused, still-dirty text node: by the
  // time replaceChildren runs, textDirty is already false, so the
  // synchronous focusout that the removal fires finds nothing to flush and
  // does not re-render.
  function flushText() {
    if (!textDirty) return
    textDirty = false
    history.push(state)
    onChange(clone(state))
  }

  function isEditingText() {
    return roleOf(document.activeElement) === "text"
  }

  function focusText(id) {
    const text = svg.querySelector(`[data-id="${id}"] [data-role="text"]`)
    if (text) text.focus()
  }

  function isOtherPointer(event) {
    return (draft || drag || marquee) && event.pointerId !== activePointerId
  }

  function isSelected(id) {
    return selection.includes(id)
  }

  function toggle(ids, id) {
    return ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]
  }

  function selectionMode(event) {
    if (event.ctrlKey || event.metaKey) return "toggle"
    if (event.shiftKey) return "add"
    return "replace"
  }

  // Shapes lie in the marquee only if their bounds are entirely inside it.
  function marqueeHits(rect) {
    return state
      .filter(shape => {
        const b = shapeBounds(shape)
        return (
          b.x >= rect.x &&
          b.y >= rect.y &&
          b.x + b.w <= rect.x + rect.w &&
          b.y + b.h <= rect.y + rect.h
        )
      })
      .map(shape => shape.id)
  }

  function capture(event) {
    activePointerId = event.pointerId
    svg.setPointerCapture(event.pointerId)
  }

  function onPointerDown(event) {
    if (event.button !== 0) return
    if (isOtherPointer(event)) return
    const role = roleOf(event.target)
    if (role === "text") return
    container.focus({ preventScroll: true })
    const point = toImagePoint(event)

    if (tool === "pen" || tool === "highlight") {
      draft = createStroke(tool, [clampPoint(point, image)])
      capture(event)
      render()
      event.preventDefault()
      return
    }

    if (tool === "callout") {
      const callout = createCallout(clampPoint(point, image), image)
      state = [...state, callout]
      selection = [callout.id]
      commit()
      tool = "select"
      render()
      focusText(callout.id)
      onToolChange(tool)
      event.preventDefault()
      return
    }

    const group = event.target.closest
      ? event.target.closest("[data-id]")
      : null
    const mode = selectionMode(event)
    if (!group) {
      const start = clampPoint(point, image)
      marquee = {
        start,
        end: start,
        startClient: [event.clientX, event.clientY],
        mode,
      }
      capture(event)
      render()
      event.preventDefault()
      return
    }

    const id = group.getAttribute("data-id")
    if (mode === "toggle") selection = toggle(selection, id)
    else if (mode === "add") {
      if (!isSelected(id)) selection = [...selection, id]
    } else if (!isSelected(id)) selection = [id]

    if (isSelected(id)) {
      drag = {
        id,
        role: role || "shape",
        last: point,
        moved: false,
        before: state,
      }
      capture(event)
    }
    render()
    event.preventDefault()
  }

  function onPointerMove(event) {
    if (isOtherPointer(event)) return
    if (draft) {
      draft.points.push(clampPoint(toImagePoint(event), image))
      render()
      return
    }
    if (marquee) {
      marquee.end = clampPoint(toImagePoint(event), image)
      render()
      return
    }
    if (!drag) return

    const point = toImagePoint(event)
    const dx = point[0] - drag.last[0]
    const dy = point[1] - drag.last[1]
    drag.last = point
    drag.moved = true
    const shape = find(drag.id)
    if (!shape) return

    if (drag.role === "anchor") {
      replace({
        ...shape,
        anchor: clampPoint([shape.anchor[0] + dx, shape.anchor[1] + dy], image),
      })
    } else if (drag.role === "box") {
      replace({
        ...shape,
        box: clampBox(
          { ...shape.box, x: shape.box.x + dx, y: shape.box.y + dy },
          image,
        ),
      })
    } else if (drag.role === "resize") {
      // The handle sets the width; the height always fits the text.
      const widened = {
        ...shape,
        box: {
          ...shape.box,
          w: Math.max(CALLOUT_DEFAULTS.minWidth, shape.box.w + dx),
        },
      }
      const fitted = fitCallout(widened)
      replace({ ...fitted, box: clampBox(fitted.box, image) })
    } else {
      // A stroke's hit path or a callout's connector (no data-role, so the
      // role defaulted to "shape"): move the whole selection. Limit dx/dy by
      // the union of the selected bounds so every shape stays inside the
      // image without clamping points independently (which would distort
      // strokes and pull callout anchors away from their boxes).
      const moving = state.filter(other => isSelected(other.id))
      const bounds = unionBounds(moving.map(shapeBounds))
      const minDx = -bounds.x
      const maxDx = image.width - (bounds.x + bounds.w)
      const minDy = -bounds.y
      const maxDy = image.height - (bounds.y + bounds.h)
      const clampedDx = Math.min(Math.max(dx, minDx), maxDx)
      const clampedDy = Math.min(Math.max(dy, minDy), maxDy)
      state = state.map(other =>
        isSelected(other.id)
          ? translateShape(other, clampedDx, clampedDy)
          : other,
      )
    }
    render()
  }

  function onPointerUp(event) {
    if (isOtherPointer(event)) return
    activePointerId = null
    if (draft) {
      state = [...state, { ...draft, points: thinPath(draft.points) }]
      draft = null
      commit()
      render()
      return
    }
    if (marquee) {
      finishMarquee(event)
      return
    }
    if (drag) {
      if (drag.moved) commit()
      drag = null
      render()
    }
  }

  // The browser took the capture away without a pointerup (touch or pen
  // interrupted, element hidden): drop whatever was in progress so the next
  // pointerdown starts cleanly. After a normal pointerup nothing is active.
  function onLostPointerCapture(event) {
    if (!(draft || drag || marquee)) return
    if (event.pointerId !== activePointerId) return
    if (drag) state = drag.before
    draft = null
    drag = null
    marquee = null
    activePointerId = null
    render()
  }

  function finishMarquee(event) {
    const { start, end, startClient, mode } = marquee
    marquee = null
    if (event.type === "pointercancel") {
      render()
      return
    }
    const isClick =
      Math.abs(event.clientX - startClient[0]) < 3 &&
      Math.abs(event.clientY - startClient[1]) < 3
    if (isClick) {
      if (mode === "replace") selection = []
    } else {
      const hits = marqueeHits(rectFromPoints(start, end))
      if (mode === "replace") selection = hits
      else if (mode === "add")
        selection = [...selection, ...hits.filter(id => !isSelected(id))]
      else selection = hits.reduce(toggle, selection)
    }
    render()
  }

  function onInput(event) {
    if (roleOf(event.target) !== "text") return
    const id = event.target.closest("[data-id]").getAttribute("data-id")
    const shape = find(id)
    if (!shape) return
    const fitted = fitCallout({
      ...shape,
      text: event.target.innerText.replace(/\n$/, ""),
    })
    const next = { ...fitted, box: clampBox(fitted.box, image) }
    replace(next)
    // Re-rendering would drop the caret, so the box is resized in place.
    syncCalloutBox(event.target.closest("[data-id]"), next)
    textDirty = true
    onChange(clone(state))
  }

  function syncCalloutBox(group, shape) {
    const { box } = shape
    const set = (element, attrs) => {
      if (!element) return
      for (const [name, value] of Object.entries(attrs))
        element.setAttribute(name, String(value))
    }
    set(group.querySelector("[data-role=box]"), {
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
    })
    set(group.querySelector("foreignObject"), {
      x: box.x + TEXT_PADDING,
      y: box.y + TEXT_PADDING,
      width: Math.max(1, box.w - 2 * TEXT_PADDING),
      height: Math.max(1, box.h - 2 * TEXT_PADDING),
    })
    set(group.querySelector("[data-role=resize]"), {
      x: box.x + box.w - RESIZE_SIZE,
      y: box.y + box.h - RESIZE_SIZE,
    })
    set(group.querySelector("line"), connector(shape))
  }

  function onFocusOut(event) {
    if (roleOf(event.target) !== "text") return
    if (!textDirty) return
    flushText()
    render()
  }

  function onKeyDown(event) {
    if (isEditingText()) return
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selection.length > 0
    ) {
      deleteSelected()
      event.preventDefault()
    }
  }

  function deleteSelected() {
    flushText()
    if (selection.length === 0) return
    state = state.filter(shape => !isSelected(shape.id))
    selection = []
    commit()
    render()
  }

  function undo() {
    flushText()
    restore(history.undo())
  }

  function redo() {
    flushText()
    restore(history.redo())
  }

  function restore(next) {
    if (!next) return
    state = next
    selection = []
    draft = null
    drag = null
    marquee = null
    activePointerId = null
    onChange(clone(state))
    render()
  }

  svg.addEventListener("pointerdown", onPointerDown)
  svg.addEventListener("pointermove", onPointerMove)
  svg.addEventListener("pointerup", onPointerUp)
  svg.addEventListener("pointercancel", onPointerUp)
  svg.addEventListener("lostpointercapture", onLostPointerCapture)
  svg.addEventListener("input", onInput)
  svg.addEventListener("focusout", onFocusOut)
  container.addEventListener("keydown", onKeyDown)
  render()

  return {
    setTool(next) {
      if (!TOOLS.includes(next)) throw new Error(`Unknown tool: ${next}`)
      tool = next
      render()
    },
    getTool: () => tool,
    getAnnotations: () => clone(state),
    getSelectedId: () => selection[0] ?? null,
    getSelectedIds: () => [...selection],
    deleteSelected,
    undo,
    redo,
    destroy() {
      container.removeEventListener("keydown", onKeyDown)
      container.innerHTML = ""
      container.classList.remove("harness-annotator")
    },
  }
}
