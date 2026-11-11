import { test } from "node:test"
import assert from "node:assert/strict"
import { IMAGE_PROXY_URL, proxiedImageUrl } from "../../src/image-proxy.js"

test("the default image proxy is wsrv.nl", () => {
  assert.equal(IMAGE_PROXY_URL, "https://wsrv.nl/")
})

test("an image URL is passed to the proxy as an encoded query parameter", () => {
  assert.equal(
    proxiedImageUrl("https://example.com/a b.jpg?x=1&y=2", "https://wsrv.nl/"),
    "https://wsrv.nl/?url=https%3A%2F%2Fexample.com%2Fa%20b.jpg%3Fx%3D1%26y%3D2",
  )
})

test("a proxy that already has a query string gets the parameter appended", () => {
  assert.equal(
    proxiedImageUrl(
      "https://example.com/a.jpg",
      "http://127.0.0.1:1/proxy?v=1",
    ),
    "http://127.0.0.1:1/proxy?v=1&url=https%3A%2F%2Fexample.com%2Fa.jpg",
  )
})
