import { test } from "node:test"
import assert from "node:assert/strict"
import { parseRoute } from "../../src/router.js"

test("no parameters and ?dev route to the developer screen", () => {
  assert.deepEqual(parseRoute(""), { screen: "developer" })
  assert.deepEqual(parseRoute("?dev"), { screen: "developer" })
  assert.deepEqual(parseRoute("?code=oauth-code"), { screen: "developer" })
})

test("r routes to the reviewer screen, run mode unless mode=test", () => {
  assert.deepEqual(parseRoute("?r=ABC&mode=test"), {
    screen: "reviewer",
    shareId: "ABC",
    mode: "test",
  })
  assert.deepEqual(parseRoute("?r=ABC"), {
    screen: "reviewer",
    shareId: "ABC",
    mode: "run",
  })
  assert.deepEqual(parseRoute("?r=ABC&mode=banana&__gt_embed=tok"), {
    screen: "reviewer",
    shareId: "ABC",
    mode: "run",
  })
  assert.deepEqual(parseRoute("?r=%20%20"), { screen: "developer" })
})

test("program and session route to the inbox and session screens", () => {
  assert.deepEqual(parseRoute("?dev&program=p1"), {
    screen: "inbox",
    programId: "p1",
  })
  assert.deepEqual(parseRoute("?session=s1"), {
    screen: "session",
    sessionId: "s1",
  })
})

test("the Phase 1 key route is gone", () => {
  assert.deepEqual(parseRoute("?key=abc1234&mode=test"), {
    screen: "developer",
  })
})

test("session beats r beats program, and blank values fall through", () => {
  assert.deepEqual(parseRoute("?session=s1&r=ABC"), {
    screen: "session",
    sessionId: "s1",
  })
  assert.deepEqual(parseRoute("?r=ABC&program=p1"), {
    screen: "reviewer",
    shareId: "ABC",
    mode: "run",
  })
  assert.deepEqual(parseRoute("?session=s1&program=p1"), {
    screen: "session",
    sessionId: "s1",
  })
  assert.deepEqual(parseRoute("?session=%20&r=ABC"), {
    screen: "reviewer",
    shareId: "ABC",
    mode: "run",
  })
  assert.deepEqual(parseRoute("?program=%20"), { screen: "developer" })
})
