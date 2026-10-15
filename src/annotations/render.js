import {
  STYLES,
  connector,
  pathToD,
  rectFromPoints,
  strokeBounds,
} from "./model.js"

export const SVG_NS = "http://www.w3.org/2000/svg"
export const XHTML_NS = "http://www.w3.org/1999/xhtml"
export const CALLOUT_COLOR = "#1e88e5"
export const FONT_SIZE = 14
export const LINE_HEIGHT = 18
export const TEXT_PADDING = 8
const HIT_WIDTH = 16
const RESIZE_SIZE = 12
const ANCHOR_RADIUS = 6

export function h(tag, attrs = {}, children = []) {
  return { tag, attrs, children }
}

export function renderTree(
  annotations,
  imageSize,
  {
    mode = "static",
    selectedId = null,
    selectedIds = null,
    draft = null,
    marquee = null,
  } = {},
) {
  const selected = new Set(selectedIds || (selectedId ? [selectedId] : []))
  const children = [defs()]
  for (const shape of annotations) {
    children.push(renderShape(shape, mode, selected.has(shape.id)))
  }
  if (draft) children.push(renderShape(draft, mode, false))
  if (marquee && mode === "live") children.push(renderMarquee(marquee))
  return h(
    "svg",
    {
      xmlns: SVG_NS,
      viewBox: `0 0 ${imageSize.width} ${imageSize.height}`,
      width: imageSize.width,
      height: imageSize.height,
      "data-mode": mode,
    },
    children,
  )
}

function defs() {
  return h("defs", {}, [
    h(
      "marker",
      {
        id: "harness-arrow",
        viewBox: "0 0 10 10",
        refX: "9",
        refY: "5",
        markerWidth: "8",
        markerHeight: "8",
        orient: "auto-start-reverse",
      },
      [h("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: CALLOUT_COLOR })],
    ),
  ])
}

function renderShape(shape, mode, selected) {
  return shape.type === "callout"
    ? renderCallout(shape, mode, selected)
    : renderStroke(shape, mode, selected)
}

function renderStroke(shape, mode, selected) {
  const style = STYLES[shape.type]
  const d = pathToD(shape.points)
  const children = [
    h("path", {
      d,
      fill: "none",
      stroke: style.color,
      "stroke-width": style.width,
      "stroke-opacity": style.opacity,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      style: shape.type === "highlight" ? "mix-blend-mode: multiply" : "",
    }),
  ]
  if (mode === "live") {
    children.push(
      h("path", {
        d,
        fill: "none",
        stroke: "transparent",
        "stroke-width": Math.max(style.width, HIT_WIDTH),
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "data-role": "shape",
      }),
    )
  }
  if (selected) children.push(selectionRect(strokeBounds(shape.points)))
  return h("g", { "data-id": shape.id, "data-type": shape.type }, children)
}

function renderMarquee({ start, end }) {
  const rect = rectFromPoints(start, end)
  return h("rect", {
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    fill: "rgba(30, 136, 229, 0.1)",
    stroke: CALLOUT_COLOR,
    "stroke-dasharray": "4 3",
    "pointer-events": "none",
    "data-role": "marquee",
  })
}

function selectionRect(bounds) {
  return h("rect", {
    x: bounds.x - 4,
    y: bounds.y - 4,
    width: bounds.w + 8,
    height: bounds.h + 8,
    fill: "none",
    stroke: CALLOUT_COLOR,
    "stroke-dasharray": "4 3",
    "pointer-events": "none",
    "data-role": "selection",
  })
}

function renderCallout(shape, mode, selected) {
  const { box, anchor } = shape
  const line = connector(shape)
  const children = [
    h("line", {
      x1: line.x1,
      y1: line.y1,
      x2: line.x2,
      y2: line.y2,
      stroke: CALLOUT_COLOR,
      "stroke-width": 2,
      "marker-end": "url(#harness-arrow)",
    }),
    h("circle", {
      cx: anchor[0],
      cy: anchor[1],
      r: ANCHOR_RADIUS,
      fill: CALLOUT_COLOR,
      "data-role": "anchor",
    }),
    h("rect", {
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      rx: 4,
      fill: "#fff",
      stroke: CALLOUT_COLOR,
      "stroke-width": selected ? 3 : 2,
      "data-role": "box",
    }),
  ]

  if (mode === "live") {
    children.push(
      h(
        "foreignObject",
        {
          x: box.x + TEXT_PADDING,
          y: box.y + TEXT_PADDING,
          width: Math.max(1, box.w - 2 * TEXT_PADDING),
          height: Math.max(1, box.h - 2 * TEXT_PADDING),
        },
        [
          h(
            "div",
            {
              xmlns: XHTML_NS,
              contenteditable: "true",
              "data-role": "text",
              class: "harness-callout-text",
            },
            [shape.text],
          ),
        ],
      ),
    )
    children.push(
      h("rect", {
        x: box.x + box.w - RESIZE_SIZE,
        y: box.y + box.h - RESIZE_SIZE,
        width: RESIZE_SIZE,
        height: RESIZE_SIZE,
        fill: CALLOUT_COLOR,
        "data-role": "resize",
        style: "cursor: nwse-resize",
      }),
    )
  } else {
    const lines = wrapText(shape.text, box.w - 2 * TEXT_PADDING)
    children.push(
      h(
        "text",
        {
          x: box.x + TEXT_PADDING,
          y: box.y + TEXT_PADDING + FONT_SIZE,
          "font-size": FONT_SIZE,
          "font-family": "sans-serif",
          fill: "#000",
        },
        lines.map((text, index) =>
          h(
            "tspan",
            { x: box.x + TEXT_PADDING, dy: index === 0 ? 0 : LINE_HEIGHT },
            [text],
          ),
        ),
      ),
    )
  }

  return h("g", { "data-id": shape.id, "data-type": "callout" }, children)
}

export function wrapText(text, maxWidth, fontSize = FONT_SIZE) {
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.55)))
  const lines = []
  for (const paragraph of String(text).split("\n")) {
    let line = ""
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const chunks =
        word.length > maxChars
          ? word.match(new RegExp(`.{1,${maxChars}}`, "g"))
          : [word]
      for (const chunk of chunks) {
        if (line === "") line = chunk
        else if (line.length + 1 + chunk.length <= maxChars) line += " " + chunk
        else {
          lines.push(line)
          line = chunk
        }
      }
    }
    lines.push(line)
  }
  return lines
}

export function toSvgString(node) {
  if (typeof node === "string") return escapeText(node)
  const attrs = Object.entries(node.attrs)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    )
    .map(([name, value]) => ` ${name}="${escapeAttr(String(value))}"`)
    .join("")
  const inner = node.children.map(toSvgString).join("")
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`
}

export function toDom(node, doc = document) {
  if (typeof node === "string") return doc.createTextNode(node)
  const namespace = node.attrs.xmlns === XHTML_NS ? XHTML_NS : SVG_NS
  const element = doc.createElementNS(namespace, node.tag)
  for (const [name, value] of Object.entries(node.attrs)) {
    if (
      name === "xmlns" ||
      value === undefined ||
      value === null ||
      value === ""
    )
      continue
    element.setAttribute(name, String(value))
  }
  for (const child of node.children) element.appendChild(toDom(child, doc))
  return element
}

function escapeText(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function escapeAttr(text) {
  return escapeText(text).replace(/"/g, "&quot;")
}
