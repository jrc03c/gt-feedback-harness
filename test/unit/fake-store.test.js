import { test } from "node:test"
import assert from "node:assert/strict"
import { createFakeStore } from "../fixtures/fake-store.js"

const item = () => ({
  image: { blob: new Blob(["x"]), width: 1, height: 1, scale: 1 },
  text: "t",
  annotations: [],
  context: {},
})

const seeded = () =>
  createFakeStore({
    user: { id: "anon-1", is_anonymous: true },
    programs: [
      { id: "p1", gt_key: "abc", label: "One", share_id: "SHARE1" },
      { id: "p2", gt_key: "def", label: "Two", share_id: "SHARE2" },
    ],
  })

test("signInWithProvider sets a developer user and notifies listeners", async () => {
  const store = createFakeStore()
  const seen = []
  store.onAuthChange(user => seen.push(user))
  await store.signInWithProvider("github", "/")
  assert.equal(store.state.user.id, "dev-1")
  assert.equal(store.state.user.is_anonymous, false)
  assert.deepEqual(seen, [store.state.user])
})

test("resolveShare finds a seeded program and returns null otherwise", async () => {
  const store = seeded()
  assert.deepEqual(await store.resolveShare("SHARE1"), {
    programId: "p1",
    gtKey: "abc",
  })
  assert.equal(await store.resolveShare("NOPE"), null)
})

test("createSession then sendItem store a session, an item, and a blob", async () => {
  const store = seeded()
  const sessionId = await store.createSession({
    programId: "p1",
    shareId: "SHARE1",
    mode: "test",
  })
  const itemId = await store.sendItem(sessionId, item())
  assert.equal(store.state.sessions.length, 1)
  assert.equal(store.state.items.length, 1)
  const row = store.state.items[0]
  assert.equal(row.id, itemId)
  assert.equal(row.session_id, sessionId)
  assert.equal(row.screenshot_path, `${sessionId}/${itemId}.webp`)
  assert.ok(store.state.screenshots.get(row.screenshot_path) instanceof Blob)
  assert.equal(
    await store.downloadScreenshot(row.screenshot_path),
    store.state.screenshots.get(row.screenshot_path),
  )
})

test("listPrograms returns session_count and unresolved_count", async () => {
  const store = seeded()
  const s = await store.createSession({
    programId: "p1",
    shareId: "SHARE1",
    mode: "test",
  })
  const a = await store.sendItem(s, item())
  await store.sendItem(s, item())
  await store.setResolved(a, true)
  const [p1, p2] = await store.listPrograms()
  assert.equal(p1.session_count, 1)
  assert.equal(p1.unresolved_count, 1)
  assert.equal(p2.session_count, 0)
  assert.equal(p2.unresolved_count, 0)
})

test("listSessions sorts newest first with item counts", async () => {
  const store = createFakeStore({
    user: { id: "u" },
    sessions: [
      { id: "old", program_id: "p1", started_at: "2026-01-01T00:00:00.000Z" },
      { id: "new", program_id: "p1", started_at: "2026-02-01T00:00:00.000Z" },
      { id: "other", program_id: "p2", started_at: "2026-03-01T00:00:00.000Z" },
    ],
    items: [
      { id: "i1", session_id: "new", resolved_at: null },
      { id: "i2", session_id: "new", resolved_at: "2026-02-02T00:00:00.000Z" },
    ],
  })
  const sessions = await store.listSessions("p1")
  assert.deepEqual(
    sessions.map(s => s.id),
    ["new", "old"],
  )
  assert.equal(sessions[0].item_count, 2)
  assert.equal(sessions[0].unresolved_count, 1)
  assert.equal(sessions[1].item_count, 0)
})

test("setResolved flips resolved_at", async () => {
  const store = seeded()
  const s = await store.createSession({
    programId: "p1",
    shareId: "SHARE1",
    mode: "test",
  })
  const id = await store.sendItem(s, item())
  await store.setResolved(id, true)
  assert.ok(store.state.items[0].resolved_at)
  await store.setResolved(id, false)
  assert.equal(store.state.items[0].resolved_at, null)
})

test("deleteSession removes the session and its items", async () => {
  const store = seeded()
  const s1 = await store.createSession({
    programId: "p1",
    shareId: "SHARE1",
    mode: "test",
  })
  const s2 = await store.createSession({
    programId: "p1",
    shareId: "SHARE1",
    mode: "test",
  })
  await store.sendItem(s1, item())
  await store.sendItem(s2, item())
  await store.deleteSession(s1)
  assert.deepEqual(
    store.state.sessions.map(s => s.id),
    [s2],
  )
  assert.equal(store.state.items.length, 1)
  assert.equal(store.state.items[0].session_id, s2)
})
