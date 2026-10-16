import { test } from "node:test"
import assert from "node:assert/strict"
import { newShareId } from "../../src/share-id.js"

test("share ids are 24 alphanumeric characters and differ between calls", () => {
  const a = newShareId()
  const b = newShareId()
  assert.match(a, /^[A-Za-z0-9]{24}$/)
  assert.match(b, /^[A-Za-z0-9]{24}$/)
  assert.notEqual(a, b)
})
