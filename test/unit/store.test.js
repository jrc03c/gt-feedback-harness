import { test } from "node:test"
import assert from "node:assert/strict"
import { createStore, SCREENSHOT_BUCKET } from "../../src/store.js"
import { createFakeSupabase } from "../fixtures/fake-supabase.js"

const store = (responses, authState) => {
  const client = createFakeSupabase(responses, authState)
  return {
    client,
    store: createStore({ url: "https://x.supabase.co", anonKey: "k", client }),
  }
}

test("signInAnonymously reuses an existing session and otherwise signs in", async () => {
  const existing = store({}, { user: { id: "u1" } })
  assert.deepEqual(await existing.store.signInAnonymously(), { id: "u1" })
  const fresh = store({})
  assert.equal((await fresh.store.signInAnonymously()).id, "anon-uid")
})

test("resolveShare maps the rpc row and returns null for unknown ids", async () => {
  const { client, store: s } = store({
    "rpc:resolve_share": record =>
      record.steps[0][1][0].share === "KNOWN"
        ? { data: [{ program_id: "p1", gt_key: "abc1234" }], error: null }
        : { data: [], error: null },
  })
  assert.deepEqual(await s.resolveShare("KNOWN"), {
    programId: "p1",
    gtKey: "abc1234",
  })
  assert.equal(await s.resolveShare("NOPE"), null)
  assert.equal(client.stepsOf("rpc", "resolve_share").length, 2)
})

test("errors from Supabase are thrown", async () => {
  const { store: s } = store({
    "rpc:resolve_share": { data: null, error: { message: "boom" } },
  })
  await assert.rejects(() => s.resolveShare("X"), /boom/)
})

test("createSession inserts the row and returns its id", async () => {
  const { client, store: s } = store(
    { "from:sessions": { data: { id: "s1" }, error: null } },
    { user: { id: "anon-uid" } },
  )
  const id = await s.createSession({
    programId: "p1",
    shareId: "SHARE",
    mode: "test",
    reviewerName: "Alice",
    userAgent: "UA",
    viewport: { width: 800, height: 600 },
  })
  assert.equal(id, "s1")
  const [steps] = client.stepsOf("from", "sessions")
  assert.deepEqual(steps[0], [
    "insert",
    [
      {
        program_id: "p1",
        share_id: "SHARE",
        reviewer_uid: "anon-uid",
        reviewer_name: "Alice",
        mode: "test",
        user_agent: "UA",
        viewport: { width: 800, height: 600 },
      },
    ],
  ])
  assert.deepEqual(steps[1], ["select", ["id"]])
  assert.deepEqual(steps[2], ["single", []])
})

test("sendItem uploads the screenshot then inserts the item with its path", async () => {
  const { client, store: s } = store({
    "from:items": { data: { id: "ignored" }, error: null },
  })
  const blob = new Blob(["x"], { type: "image/webp" })
  const id = await s.sendItem("s1", {
    image: { blob, width: 800, height: 600, scale: 1 },
    annotations: [{ id: "a" }],
    text: "Looks wrong",
    context: { lines: [] },
  })
  assert.match(id, /^[0-9a-f-]{36}$/)
  const [upload] = client.stepsOf("storage", SCREENSHOT_BUCKET)
  assert.equal(upload[0][0], "upload")
  assert.equal(upload[0][1][0], `s1/${id}.webp`)
  assert.equal(upload[0][1][1], blob)
  assert.deepEqual(upload[0][1][2], {
    contentType: "image/webp",
    upsert: false,
  })
  const [insert] = client.stepsOf("from", "items")
  assert.deepEqual(insert[0], [
    "insert",
    [
      {
        id,
        session_id: "s1",
        text: "Looks wrong",
        annotations: [{ id: "a" }],
        context: { lines: [] },
        screenshot_path: `s1/${id}.webp`,
        image_size: { width: 800, height: 600, scale: 1 },
      },
    ],
  ])
})

test("registerProgram inserts with a fresh share id and the owner", async () => {
  const { client, store: s } = store(
    {
      "from:programs": record => ({
        data: { id: "p1", ...record.steps[0][1][0] },
        error: null,
      }),
    },
    { user: { id: "dev-1" } },
  )
  const program = await s.registerProgram({
    gtKey: " abc1234 ",
    label: "Sleep",
  })
  assert.equal(program.gt_key, "abc1234")
  assert.match(program.share_id, /^[A-Za-z0-9]{24}$/)
  assert.equal(client.stepsOf("from", "programs")[0][0][1][0].owner_id, "dev-1")
})

test("listSessions derives item counts from the nested items", async () => {
  const { store: s } = store({
    "from:sessions": {
      data: [
        {
          id: "s1",
          items: [
            { id: "i1", resolved_at: null },
            { id: "i2", resolved_at: "2026-10-16T00:00:00Z" },
          ],
        },
        { id: "s2", items: [] },
      ],
      error: null,
    },
  })
  const sessions = await s.listSessions("p1")
  assert.deepEqual(
    sessions.map(x => [x.id, x.item_count, x.unresolved_count]),
    [
      ["s1", 2, 1],
      ["s2", 0, 0],
    ],
  )
})

test("deleteSession removes the screenshots in its folder before the row", async () => {
  const { client, store: s } = store({
    "storage:screenshots": record =>
      record.steps[0][0] === "list"
        ? { data: [{ name: "a.webp" }, { name: "b.webp" }], error: null }
        : { data: [], error: null },
    "from:sessions": { data: null, error: null },
  })
  await s.deleteSession("s1")
  const storageSteps = client.stepsOf("storage", "screenshots")
  assert.deepEqual(storageSteps[0][0], [
    "list",
    ["s1", { limit: 1000, offset: 0 }],
  ])
  assert.deepEqual(storageSteps[1][0], ["remove", [["s1/a.webp", "s1/b.webp"]]])
  const [rowSteps] = client.stepsOf("from", "sessions")
  assert.deepEqual(rowSteps, [
    ["delete", []],
    ["eq", ["id", "s1"]],
  ])
})

test("deleteSession pages through more than 1000 screenshots", async () => {
  const names = Array.from({ length: 1500 }, (_, i) => ({ name: `${i}.webp` }))
  const { client, store: s } = store({
    "storage:screenshots": record => {
      const [method, args] = record.steps[0]
      if (method !== "list") return { data: [], error: null }
      const { limit, offset } = args[1]
      return { data: names.slice(offset, offset + limit), error: null }
    },
    "from:sessions": { data: null, error: null },
  })
  await s.deleteSession("s1")
  const steps = client.stepsOf("storage", "screenshots").map(st => st[0])
  const lists = steps.filter(([method]) => method === "list")
  assert.deepEqual(
    lists.map(([, args]) => args[1]),
    [
      { limit: 1000, offset: 0 },
      { limit: 1000, offset: 1000 },
    ],
  )
  const removed = steps
    .filter(([method]) => method === "remove")
    .flatMap(([, args]) => args[0])
  assert.equal(removed.length, 1500)
  assert.equal(new Set(removed).size, 1500)
  assert.ok(removed.every(path => path.startsWith("s1/")))
})

test("setResolved writes or clears resolved_at", async () => {
  const { client, store: s } = store({
    "from:items": { data: null, error: null },
  })
  await s.setResolved("i1", true)
  await s.setResolved("i1", false)
  const [first, second] = client.stepsOf("from", "items")
  assert.equal(first[0][0], "update")
  assert.match(first[0][1][0].resolved_at, /^\d{4}-/)
  assert.deepEqual(second[0], ["update", [{ resolved_at: null }]])
})

test("renameProgram updates only the label, trimmed, and clears it when empty", async () => {
  const { client, store: s } = store({
    "from:programs": { data: null, error: null },
  })
  assert.equal(await s.renameProgram("p1", "  Kitchen sink "), "Kitchen sink")
  assert.equal(await s.renameProgram("p1", "   "), null)
  const [first, second] = client.stepsOf("from", "programs")
  assert.deepEqual(first, [
    ["update", [{ label: "Kitchen sink" }]],
    ["eq", ["id", "p1"]],
  ])
  assert.deepEqual(second[0], ["update", [{ label: null }]])
})

test("signInWithProvider passes the provider and redirect", async () => {
  const { client, store: s } = store({})
  await s.signInWithProvider("google", "https://example.test/?dev")
  const call = client.calls.find(c => c.name === "signInWithOAuth")
  assert.deepEqual(call.steps[0][1][0], {
    provider: "google",
    options: { redirectTo: "https://example.test/?dev" },
  })
})
