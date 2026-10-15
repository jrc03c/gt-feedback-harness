export const STYLES = {
  pen: { width: 4, color: "#e53935", opacity: 1 },
  highlight: { width: 24, color: "#ffeb3b", opacity: 0.4 },
}

export const CALLOUT_DEFAULTS = {
  width: 180,
  height: 64,
  offsetX: 40,
  offsetY: -110,
  minWidth: 80,
  minHeight: 40,
}

export function createId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function createStroke(type, points) {
  if (!STYLES[type]) throw new Error(`Unknown stroke type: ${type}`)
  return { id: createId(), type, points: points.map(([x, y]) => [x, y]) }
}

export function createCallout(anchor, imageSize) {
  const d = CALLOUT_DEFAULTS
  const box = clampBox(
    {
      x: anchor[0] + d.offsetX,
      y: anchor[1] + d.offsetY,
      w: d.width,
      h: d.height,
    },
    imageSize,
  )
  return {
    id: createId(),
    type: "callout",
    anchor: [anchor[0], anchor[1]],
    box,
    text: "",
  }
}

export function clampBox(box, imageSize) {
  const w = Math.min(box.w, imageSize.width)
  const h = Math.min(box.h, imageSize.height)
  const x = Math.min(Math.max(0, box.x), imageSize.width - w)
  const y = Math.min(Math.max(0, box.y), imageSize.height - h)
  return { x, y, w, h }
}

export function clampPoint([x, y], imageSize) {
  return [
    Math.min(Math.max(0, x), imageSize.width),
    Math.min(Math.max(0, y), imageSize.height),
  ]
}

export function translateShape(shape, dx, dy) {
  if (shape.type === "callout") {
    return {
      ...shape,
      anchor: [shape.anchor[0] + dx, shape.anchor[1] + dy],
      box: { ...shape.box, x: shape.box.x + dx, y: shape.box.y + dy },
    }
  }
  return { ...shape, points: shape.points.map(([x, y]) => [x + dx, y + dy]) }
}

export function strokeBounds(points) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// Bounds used for marquee hit-testing and group-drag clamping: a stroke's
// points, or a callout's box joined with its anchor.
export function shapeBounds(shape) {
  if (shape.type !== "callout") return strokeBounds(shape.points)
  const { box, anchor } = shape
  return strokeBounds([[box.x, box.y], [box.x + box.w, box.y + box.h], anchor])
}

export function rectFromPoints(start, end) {
  const x = Math.min(start[0], end[0])
  const y = Math.min(start[1], end[1])
  return {
    x,
    y,
    w: Math.max(start[0], end[0]) - x,
    h: Math.max(start[1], end[1]) - y,
  }
}

// Ramer-Douglas-Peucker simplification.
export function thinPath(points, tolerance = 1.5) {
  if (points.length <= 2) return points.map(([x, y]) => [x, y])
  const first = points[0]
  const last = points[points.length - 1]
  let maxDistance = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToSegment(points[i], first, last)
    if (distance > maxDistance) {
      maxDistance = distance
      index = i
    }
  }
  if (maxDistance > tolerance) {
    const left = thinPath(points.slice(0, index + 1), tolerance)
    const right = thinPath(points.slice(index), tolerance)
    return left.slice(0, -1).concat(right)
  }
  return [
    [first[0], first[1]],
    [last[0], last[1]],
  ]
}

function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2),
  )
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

export function nearestPointOnRect(point, box) {
  const x = Math.min(Math.max(point[0], box.x), box.x + box.w)
  const y = Math.min(Math.max(point[1], box.y), box.y + box.h)
  const inside = x === point[0] && y === point[1]
  if (!inside) return [x, y]

  const toLeft = point[0] - box.x
  const toRight = box.x + box.w - point[0]
  const toTop = point[1] - box.y
  const toBottom = box.y + box.h - point[1]
  const nearest = Math.min(toLeft, toRight, toTop, toBottom)
  if (nearest === toLeft) return [box.x, point[1]]
  if (nearest === toRight) return [box.x + box.w, point[1]]
  if (nearest === toTop) return [point[0], box.y]
  return [point[0], box.y + box.h]
}

export function connector(callout) {
  const [x1, y1] = nearestPointOnRect(callout.anchor, callout.box)
  return { x1, y1, x2: callout.anchor[0], y2: callout.anchor[1] }
}

export function pathToD(points) {
  if (points.length === 0) return ""
  if (points.length === 1) {
    const [x, y] = points[0]
    return `M ${x} ${y} L ${x} ${y}`
  }
  return "M " + points.map(([x, y]) => `${x} ${y}`).join(" L ")
}

export function createHistory(initial) {
  const states = [clone(initial)]
  return {
    push(state) {
      states.push(clone(state))
    },
    undo() {
      if (states.length <= 1) return null
      states.pop()
      return clone(states[states.length - 1])
    },
    get length() {
      return states.length
    },
  }
}
