import { test } from "node:test"
import assert from "node:assert/strict"
import { createCommands } from "../../../src/cli/commands.js"
import { createFakeStore } from "../../fixtures/fake-store.js"

const PAGE_URL = "https://example.test/harness/"
const KEY = "abc1234"

function fakeGuidedTrack() {
  const pages = []
  return {
    pages,
    programs: [{ id: 42, key: KEY, name: "Demo Program" }],
    async findProgram(term) {
      return this.programs.find(p => p.name === term || p.key === term) || null
    },
    async allowPage(id, url) {
      if (pages.some(p => p.id === id && p.url === url)) return false
      pages.push({ id, url })
      return true
    },
  }
}

function fakeFiles() {
  const written = new Map()
  const dirs = []
  return {
    written,
    dirs,
    async mkdir(path) {
      dirs.push(path)
    },
    async write(path, data) {
      written.set(path, data)
    },
  }
}

function setup(seed = {}) {
  const store = createFakeStore({
    user: { id: "dev-1", email: "dev@example.com", is_anonymous: false },
    ...seed,
  })
  const guidedtrack = fakeGuidedTrack()
  const files = fakeFiles()
  const flattened = []
  const commands = createCommands({
    store,
    guidedtrack,
    files,
    pageUrl: PAGE_URL,
    flatten: async spec => {
      flattened.push(spec)
      return spec.out
    },
  })
  return { store, guidedtrack, files, flattened, commands }
}

test("setup allows the harness page on GuidedTrack, registers the key, and prints the links", async () => {
  const { store, guidedtrack, commands } = setup()
  const result = await commands.setup("Demo Program", {})
  assert.deepEqual(guidedtrack.pages, [{ id: 42, url: PAGE_URL }])
  const [program] = store.state.programs
  assert.equal(program.gt_key, KEY)
  assert.equal(program.label, "Demo Program")
  assert.deepEqual(result, {
    program: {
      id: program.id,
      gt_key: KEY,
      label: "Demo Program",
      share_id: program.share_id,
    },
    guidedtrack: { id: 42, key: KEY, name: "Demo Program" },
    links: {
      run: `${PAGE_URL}?r=${program.share_id}&mode=run`,
      test: `${PAGE_URL}?r=${program.share_id}&mode=test`,
    },
    page_added: true,
    registered: true,
  })
})

test("setup is idempotent and honours an explicit label on first registration", async () => {
  const { store, commands } = setup()
  const first = await commands.setup(KEY, { label: "Custom" })
  const second = await commands.setup(KEY, { label: "Ignored" })
  assert.equal(store.state.programs.length, 1)
  assert.equal(first.program.label, "Custom")
  assert.equal(second.program.label, "Custom")
  assert.equal(second.page_added, false)
  assert.equal(second.registered, false)
  assert.equal(second.links.run, first.links.run)
})

test("setup without GuidedTrack credentials registers a key and says the page step was skipped", async () => {
  const { store, files } = setup()
  const commands = createCommands({ store, files, pageUrl: PAGE_URL })
  const result = await commands.setup(KEY, {})
  assert.equal(result.page_added, null)
  assert.equal(result.guidedtrack, null)
  assert.equal(result.program.gt_key, KEY)
  await assert.rejects(() => commands.setup("Demo Program", {}), /GT_EMAIL/)
})

test("setup fails clearly when GuidedTrack has no such program", async () => {
  const { commands } = setup()
  await assert.rejects(
    () => commands.setup("Missing", {}),
    /No GuidedTrack program/,
  )
})

test("programs lists registered programs with their links", async () => {
  const { commands } = setup()
  await commands.setup(KEY, {})
  const result = await commands.programs()
  assert.equal(result.length, 1)
  assert.equal(result[0].gt_key, KEY)
  assert.match(result[0].links.test, /mode=test$/)
})

const seeded = () => {
  const program = {
    id: "p-1",
    owner_id: "dev-1",
    gt_key: KEY,
    label: "Demo",
    share_id: "SHARESHARESHARESHARESHAR",
    created_at: "2026-10-16T00:00:00Z",
  }
  const session = {
    id: "s-1",
    program_id: "p-1",
    share_id: program.share_id,
    reviewer_uid: "anon-1",
    reviewer_name: "Alice",
    mode: "test",
    started_at: "2026-10-16T01:00:00Z",
    last_seen_at: "2026-10-16T01:05:00Z",
  }
  const items = [
    {
      id: "i-1",
      session_id: "s-1",
      created_at: "2026-10-16T01:02:00Z",
      text: "Typo here",
      annotations: [
        {
          id: "a",
          type: "pen",
          points: [
            [1, 1],
            [2, 2],
          ],
        },
      ],
      context: {
        lines: [{ from: 3, to: 4 }],
        variables: { x: 1 },
        runId: "r1",
      },
      screenshot_path: "s-1/i-1.webp",
      image_size: { width: 800, height: 600, scale: 2 },
      resolved_at: null,
    },
    {
      id: "i-2",
      session_id: "s-1",
      created_at: "2026-10-16T01:03:00Z",
      text: "Already handled",
      annotations: [],
      context: {},
      screenshot_path: null,
      image_size: null,
      resolved_at: "2026-10-16T02:00:00Z",
    },
  ]
  return { programs: [program], sessions: [session], items }
}

test("feedback returns unresolved items with their session and context, and writes the screenshots", async () => {
  const ctx = setup(seeded())
  ctx.store.state.screenshots.set("s-1/i-1.webp", new Blob(["webp-bytes"]))
  const result = await ctx.commands.feedback(KEY, { out: "out" })
  assert.equal(result.program.gt_key, KEY)
  assert.equal(result.items.length, 1)
  const [item] = result.items
  assert.equal(item.id, "i-1")
  assert.equal(item.text, "Typo here")
  assert.deepEqual(item.session, {
    id: "s-1",
    reviewer_name: "Alice",
    mode: "test",
    started_at: "2026-10-16T01:00:00Z",
  })
  assert.deepEqual(item.context, {
    lines: [{ from: 3, to: 4 }],
    variables: { x: 1 },
    runId: "r1",
  })
  assert.deepEqual(item.files, {
    screenshot: "out/i-1.webp",
    overlay: "out/i-1.svg",
    annotated: "out/i-1.png",
  })
  assert.deepEqual(ctx.files.dirs, ["out"])
  assert.equal(
    Buffer.from(ctx.files.written.get("out/i-1.webp")).toString(),
    "webp-bytes",
  )
  assert.match(ctx.files.written.get("out/i-1.svg"), /<svg /)
  assert.deepEqual(ctx.flattened, [
    {
      raw: "out/i-1.webp",
      overlay: "out/i-1.svg",
      out: "out/i-1.png",
      width: 800,
      height: 600,
    },
  ])
})

test("feedback --all includes resolved items and tolerates a missing screenshot", async () => {
  const ctx = setup(seeded())
  ctx.store.state.screenshots.set("s-1/i-1.webp", new Blob(["x"]))
  const result = await ctx.commands.feedback(KEY, { all: true, out: "out" })
  assert.deepEqual(
    result.items.map(i => i.id),
    ["i-1", "i-2"],
  )
  assert.equal(result.items[1].files, null)
  assert.equal(result.items[1].resolved_at, "2026-10-16T02:00:00Z")
})

test("feedback notes when nothing could flatten the screenshots", async () => {
  const ctx = setup(seeded())
  ctx.store.state.screenshots.set("s-1/i-1.webp", new Blob(["x"]))
  const flatten = async () => null
  flatten.unavailable = "ImageMagick not found"
  const commands = createCommands({
    store: ctx.store,
    files: ctx.files,
    pageUrl: PAGE_URL,
    flatten,
  })
  const result = await commands.feedback(KEY, { out: "out" })
  assert.equal(result.items[0].files.annotated, null)
  assert.equal(result.warning, "ImageMagick not found")
})

test("sessions lists a program's sessions by key or harness id", async () => {
  const { commands } = setup(seeded())
  const byKey = await commands.sessions(KEY)
  const byId = await commands.sessions("p-1")
  assert.equal(byKey.length, 1)
  assert.equal(byKey[0].id, "s-1")
  assert.equal(byKey[0].unresolved_count, 1)
  assert.deepEqual(byId, byKey)
  await assert.rejects(() => commands.sessions("zzz"), /No registered program/)
})

test("resolve and unresolve flip an item's resolved state", async () => {
  const { store, commands } = setup(seeded())
  assert.deepEqual(await commands.resolve("i-1"), { id: "i-1", resolved: true })
  assert.ok(store.state.items[0].resolved_at)
  assert.deepEqual(await commands.unresolve("i-1"), {
    id: "i-1",
    resolved: false,
  })
  assert.equal(store.state.items[0].resolved_at, null)
})
