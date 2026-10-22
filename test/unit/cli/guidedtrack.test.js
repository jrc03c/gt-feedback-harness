import { test } from "node:test"
import assert from "node:assert/strict"
import { createGuidedTrack } from "../../../src/cli/guidedtrack.js"

// Enough programs that the last one sits on the second page of 50.
const PROGRAMS = [
  { id: 1, key: "aaa1111", name: "Alpha" },
  { id: 2, key: "bbb2222", name: "Alpha Beta" },
  ...Array.from({ length: 50 }, (_, i) => ({
    id: 10 + i,
    key: `fill${i}`,
    name: `Filler ${i}`,
  })),
  { id: 3, key: "ccc3333", name: "Gamma" },
]

// A stand-in for fetch that serves a paged program list, a name search, and
// a pages resource, recording every request.
function fakeFetch({ pages = {}, perPage = 50 } = {}) {
  const requests = []
  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  const fetch = async (url, init = {}) => {
    const u = new URL(url)
    requests.push({
      method: init.method || "GET",
      path: u.pathname + u.search,
      auth: init.headers?.Authorization,
      body: init.body ? JSON.parse(init.body) : undefined,
    })
    if (u.pathname === "/programs.json") {
      const query = u.searchParams.get("query")
      if (query) {
        const words = query.toLowerCase().split(/\s+/)
        return json(
          200,
          PROGRAMS.filter(p =>
            words.every(w => p.name.toLowerCase().includes(w)),
          ),
        )
      }
      const page = Number(u.searchParams.get("page") || 1)
      return json(200, PROGRAMS.slice((page - 1) * perPage, page * perPage))
    }
    const match = u.pathname.match(/^\/programs\/(\d+)\/pages$/)
    if (match && init.method === "POST") {
      const list = (pages[match[1]] ||= [])
      const body = JSON.parse(init.body)
      const page = {
        id: 100 + list.length,
        url: body.page.url,
        program_id: Number(match[1]),
        main: list.length === 0,
      }
      list.push(page)
      return json(200, { page })
    }
    if (match) return json(200, { pages: pages[match[1]] || [] })
    return json(404, {})
  }
  return { fetch, requests, pages }
}

const client = overrides =>
  createGuidedTrack({
    email: "me@example.com",
    password: "s3cret",
    ...overrides,
  })

test("findProgram matches a name exactly through the search endpoint", async () => {
  const { fetch, requests } = fakeFetch()
  const gt = client({ fetch })
  assert.deepEqual(await gt.findProgram("Alpha"), PROGRAMS[0])
  assert.equal(requests[0].path, "/programs.json?query=Alpha")
  assert.equal(
    requests[0].auth,
    "Basic " + Buffer.from("me@example.com:s3cret").toString("base64"),
  )
})

test("findProgram falls back to paging through the list to match a key", async () => {
  const { fetch, requests } = fakeFetch()
  const gt = client({ fetch })
  assert.deepEqual(await gt.findProgram("ccc3333"), PROGRAMS.at(-1))
  assert.deepEqual(
    requests.map(r => r.path),
    [
      "/programs.json?query=ccc3333",
      "/programs.json?page=1",
      "/programs.json?page=2",
    ],
  )
})

test("findProgram returns null when nothing matches", async () => {
  const { fetch } = fakeFetch()
  assert.equal(await client({ fetch }).findProgram("Nope"), null)
})

test("allowPage adds the url once and reports whether it was added", async () => {
  const { fetch, pages } = fakeFetch({
    pages: { 1: [{ id: 50, url: "https://other.test/", main: true }] },
  })
  const gt = client({ fetch })
  const url = "https://example.test/harness/"
  assert.equal(await gt.allowPage(1, url), true)
  assert.equal(await gt.allowPage(1, url), false)
  assert.deepEqual(
    pages[1].map(p => p.url),
    ["https://other.test/", url],
  )
})

test("requests that fail raise an error naming the status", async () => {
  const fetch = async () => new Response("nope", { status: 401 })
  await assert.rejects(() => client({ fetch }).findProgram("x"), /401/)
})
