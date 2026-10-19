import { test } from "node:test"
import assert from "node:assert/strict"
import {
  CALLOUT_DEFAULTS,
  clampBox,
  clampPoint,
  connector,
  createCallout,
  createHistory,
  createStroke,
  nearestPointOnRect,
  pathToD,
  rectFromPoints,
  shapeBounds,
  smoothPathD,
  strokeBounds,
  thinPath,
  translateShape,
} from "../../src/annotations/model.js"

const image = { width: 400, height: 300 }

test("createStroke copies points and assigns an id", () => {
  const points = [[1, 2]]
  const stroke = createStroke("pen", points)
  points[0][0] = 99
  assert.equal(stroke.type, "pen")
  assert.deepEqual(stroke.points, [[1, 2]])
  assert.equal(typeof stroke.id, "string")
  assert.throws(() => createStroke("marker", []))
})

test("createCallout places the box up and to the right of the anchor", () => {
  const callout = createCallout([10, 200], image)
  assert.deepEqual(callout.anchor, [10, 200])
  assert.deepEqual(callout.box, { x: 50, y: 90, w: 220, h: 68 })
  assert.equal(callout.text, "")
})

test("createCallout clamps the box inside the image", () => {
  const callout = createCallout([390, 20], image)
  assert.deepEqual(callout.box, { x: 180, y: 0, w: 220, h: 68 })
})

test("clampBox keeps boxes inside and shrinks oversized ones", () => {
  assert.deepEqual(
    clampBox({ x: -5, y: -5, w: 50, h: 50 }, { width: 100, height: 100 }),
    { x: 0, y: 0, w: 50, h: 50 },
  )
  assert.deepEqual(
    clampBox({ x: 80, y: 80, w: 50, h: 50 }, { width: 100, height: 100 }),
    { x: 50, y: 50, w: 50, h: 50 },
  )
  assert.deepEqual(
    clampBox({ x: 10, y: 10, w: 500, h: 500 }, { width: 100, height: 100 }),
    { x: 0, y: 0, w: 100, h: 100 },
  )
})

test("clampPoint keeps points inside the image", () => {
  assert.deepEqual(clampPoint([-3, 50], image), [0, 50])
  assert.deepEqual(clampPoint([450, 350], image), [400, 300])
})

test("translateShape moves strokes and callouts", () => {
  const stroke = createStroke("pen", [
    [0, 0],
    [10, 10],
  ])
  assert.deepEqual(translateShape(stroke, 5, -5).points, [
    [5, -5],
    [15, 5],
  ])
  const callout = createCallout([10, 200], image)
  const moved = translateShape(callout, 1, 2)
  assert.deepEqual(moved.anchor, [11, 202])
  assert.deepEqual(moved.box, { x: 51, y: 92, w: 220, h: 68 })
})

test("strokeBounds is the bounding box of the points", () => {
  assert.deepEqual(
    strokeBounds([
      [10, 20],
      [30, 5],
      [15, 25],
    ]),
    { x: 10, y: 5, w: 20, h: 20 },
  )
})

test("shapeBounds uses stroke points, and box plus anchor for callouts", () => {
  assert.deepEqual(
    shapeBounds({
      type: "pen",
      points: [
        [10, 20],
        [30, 5],
      ],
    }),
    { x: 10, y: 5, w: 20, h: 15 },
  )
  // Anchor below-left of the box: the union spans both.
  assert.deepEqual(
    shapeBounds({
      type: "callout",
      anchor: [0, 100],
      box: { x: 40, y: 10, w: 50, h: 30 },
    }),
    { x: 0, y: 10, w: 90, h: 90 },
  )
  // Anchor inside the box: the bounds are the box.
  assert.deepEqual(
    shapeBounds({
      type: "callout",
      anchor: [50, 20],
      box: { x: 40, y: 10, w: 50, h: 30 },
    }),
    { x: 40, y: 10, w: 50, h: 30 },
  )
})

test("rectFromPoints normalises a drag in any direction", () => {
  assert.deepEqual(rectFromPoints([30, 40], [10, 5]), {
    x: 10,
    y: 5,
    w: 20,
    h: 35,
  })
  assert.deepEqual(rectFromPoints([1, 2], [4, 8]), { x: 1, y: 2, w: 3, h: 6 })
})

test("thinPath drops collinear points and keeps corners", () => {
  assert.deepEqual(
    thinPath([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]),
    [
      [0, 0],
      [3, 3],
    ],
  )
  assert.deepEqual(
    thinPath([
      [0, 0],
      [5, 0.5],
      [10, 0],
    ]),
    [
      [0, 0],
      [10, 0],
    ],
  )
  assert.deepEqual(
    thinPath([
      [0, 0],
      [5, 0],
      [10, 10],
    ]),
    [
      [0, 0],
      [5, 0],
      [10, 10],
    ],
  )
  assert.deepEqual(thinPath([[7, 7]]), [[7, 7]])
})

test("nearestPointOnRect projects outside points onto the edge", () => {
  const box = { x: 10, y: 40, w: 20, h: 20 }
  assert.deepEqual(nearestPointOnRect([0, 50], box), [10, 50])
  assert.deepEqual(nearestPointOnRect([100, 100], box), [30, 60])
  assert.deepEqual(nearestPointOnRect([20, 0], box), [20, 40])
})

test("nearestPointOnRect projects inside points to the closest edge", () => {
  const box = { x: 10, y: 40, w: 20, h: 20 }
  assert.deepEqual(nearestPointOnRect([12, 50], box), [10, 50])
  assert.deepEqual(nearestPointOnRect([20, 58], box), [20, 60])
})

test("connector runs from the box edge to the anchor", () => {
  const callout = { anchor: [0, 50], box: { x: 10, y: 40, w: 20, h: 20 } }
  assert.deepEqual(connector(callout), { x1: 10, y1: 50, x2: 0, y2: 50 })
})

test("pathToD builds an SVG path, with a dot for single points", () => {
  assert.equal(pathToD([]), "")
  assert.equal(pathToD([[3, 4]]), "M 3 4 L 3 4")
  assert.equal(
    pathToD([
      [0, 0],
      [10, 10],
      [20, 0],
    ]),
    "M 0 0 L 10 10 L 20 0",
  )
})

test("smoothPathD handles short paths without curves", () => {
  assert.equal(smoothPathD([]), "")
  assert.equal(smoothPathD([[3, 4]]), "M 3 4 L 3 4")
  assert.equal(
    smoothPathD([
      [0, 0],
      [10, 10],
    ]),
    "M 0 0 L 10 10",
  )
})

test("smoothPathD keeps a straight run straight, one curve per segment", () => {
  const d = smoothPathD([
    [0, 0],
    [10, 0],
    [20, 0],
  ])
  assert.ok(d.startsWith("M 0 0 C "), d)
  assert.ok(d.endsWith(" 20 0"), d)
  const segments = d.split(" C ").slice(1)
  assert.equal(segments.length, 2)
  for (const segment of segments) {
    const numbers = segment.split(" ").map(Number)
    assert.equal(numbers.length, 6)
    // Every y (control points and end point) is on y = 0.
    assert.deepEqual([numbers[1], numbers[3], numbers[5]], [0, 0, 0])
  }
})

test("smoothPathD uses Catmull-Rom control points (tension 0.5)", () => {
  // Segment 1 (end point duplicated): c1 = p0 + (p1 - p0) / 6 = (1, 1),
  // c2 = p1 - (p2 - p0) / 6 = (4, 6). Segment 2: c1 = p1 + (p2 - p0) / 6 =
  // (8, 6), c2 = p2 - (p2 - p1) / 6 = (11, 1).
  assert.equal(
    smoothPathD([
      [0, 0],
      [6, 6],
      [12, 0],
    ]),
    "M 0 0 C 1 1 4 6 6 6 C 8 6 11 1 12 0",
  )
  const d = smoothPathD([
    [0, 0],
    [3, 7],
    [9, 2],
    [14, 8],
    [20, 1],
  ])
  assert.equal(d.split(" C ").length - 1, 4)
})

test("history undoes to the previous snapshot and stops at the initial state", () => {
  const history = createHistory([])
  history.push([{ id: "a" }])
  history.push([{ id: "a" }, { id: "b" }])
  assert.equal(history.length, 3)
  assert.deepEqual(history.undo(), [{ id: "a" }])
  assert.deepEqual(history.undo(), [])
  assert.equal(history.undo(), null)
})

test("history redoes undone states and push clears the redo stack", () => {
  const history = createHistory([])
  assert.equal(history.canUndo, false)
  assert.equal(history.canRedo, false)
  assert.equal(history.redo(), null)
  history.push([{ id: "a" }])
  history.push([{ id: "a" }, { id: "b" }])
  assert.equal(history.canUndo, true)
  assert.deepEqual(history.undo(), [{ id: "a" }])
  assert.deepEqual(history.undo(), [])
  assert.equal(history.canUndo, false)
  assert.equal(history.canRedo, true)
  assert.deepEqual(history.redo(), [{ id: "a" }])
  assert.deepEqual(history.redo(), [{ id: "a" }, { id: "b" }])
  assert.equal(history.redo(), null)
  assert.equal(history.canRedo, false)

  assert.deepEqual(history.undo(), [{ id: "a" }])
  history.push([{ id: "c" }])
  assert.equal(history.canRedo, false)
  assert.equal(history.redo(), null)
  assert.deepEqual(history.undo(), [{ id: "a" }])
})

test("history snapshots are copies", () => {
  const state = [{ id: "a" }]
  const history = createHistory([])
  history.push(state)
  state[0].id = "changed"
  history.undo()
  const redone = history.redo()
  assert.deepEqual(redone, [{ id: "a" }])
  redone[0].id = "mutated"
  history.undo()
  assert.deepEqual(history.redo(), [{ id: "a" }])
})

test("CALLOUT_DEFAULTS are the documented values", () => {
  assert.deepEqual(CALLOUT_DEFAULTS, {
    width: 220,
    height: 68,
    offsetX: 40,
    offsetY: -110,
    minWidth: 100,
    minHeight: 68,
  })
})
