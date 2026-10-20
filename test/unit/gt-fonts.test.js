import { test } from "node:test"
import assert from "node:assert/strict"
import { extractFontFaces, inlineFonts } from "../../scripts/gt-fonts.mjs"

const base = "https://www.guidedtrack.com/assets/bootstrap.css"

test("keeps only @font-face rules", () => {
  const css = `.a{color:red}@font-face{font-family:"X";src:url(/assets/x.woff2) format("woff2")}.b{margin:0}`
  assert.equal(
    extractFontFaces(css, base),
    `@font-face{font-family:"X";src:url(https://www.guidedtrack.com/assets/x.woff2) format("woff2")}`,
  )
})

test("resolves root-relative, relative and quoted URLs against the stylesheet URL", () => {
  const css = `@font-face{font-family:"X";src:url(/assets/a.eot?#iefix) format("embedded-opentype"),url("b.woff") format("woff"),url('../fonts/c.ttf')}`
  assert.equal(
    extractFontFaces(css, base),
    `@font-face{font-family:"X";src:url(https://www.guidedtrack.com/assets/a.eot?#iefix) format("embedded-opentype"),url("https://www.guidedtrack.com/assets/b.woff") format("woff"),url('https://www.guidedtrack.com/fonts/c.ttf')}`,
  )
})

test("leaves absolute and data URLs alone", () => {
  const css = `@font-face{font-family:"X";src:url(https://cdn.example/x.woff2),url(data:font/woff2;base64,AAAA)}`
  assert.equal(extractFontFaces(css, base), css)
})

test("joins several rules with newlines and returns an empty string when there are none", () => {
  const css = `@font-face{font-family:"A";src:url(/a.woff2)}\n@font-face{font-family:"B";src:url(/b.woff2)}`
  assert.equal(
    extractFontFaces(css, base),
    `@font-face{font-family:"A";src:url(https://www.guidedtrack.com/a.woff2)}\n@font-face{font-family:"B";src:url(https://www.guidedtrack.com/b.woff2)}`,
  )
  assert.equal(extractFontFaces(".a{color:red}", base), "")
})

test("inlineFonts keeps one woff2 source per rule as a data URL", async () => {
  const rules = [
    `@font-face{font-family:"X";src:url(https://x/a.eot);src:url(https://x/a.eot?#iefix) format("embedded-opentype"),url(https://x/a.woff2) format("woff2"),url(https://x/a.woff) format("woff")}`,
    `@font-face{font-family:"Y";font-weight:900;src:url(https://x/b.woff2) format("woff2"),url(https://x/b.ttf) format("truetype")}`,
  ].join("\n")
  const fetched = []
  const fetchFont = async url => {
    fetched.push(url)
    return { bytes: new Uint8Array([1, 2, 3]), type: "font/woff2" }
  }
  assert.equal(
    await inlineFonts(rules, fetchFont),
    [
      `@font-face{font-family:"X";src:url(data:font/woff2;base64,AQID) format("woff2")}`,
      `@font-face{font-family:"Y";font-weight:900;src:url(data:font/woff2;base64,AQID) format("woff2")}`,
    ].join("\n"),
  )
  assert.deepEqual(fetched, ["https://x/a.woff2", "https://x/b.woff2"])
})

test("inlineFonts falls back to woff, then any source, when there is no woff2", async () => {
  const rules = [
    `@font-face{font-family:"X";src:url(https://x/a.ttf) format("truetype"),url(https://x/a.woff) format("woff")}`,
    `@font-face{font-family:"Z";src:url(https://x/c.ttf) format("truetype")}`,
  ].join("\n")
  const fetchFont = async url => ({
    bytes: new Uint8Array([0]),
    type: url.endsWith("woff") ? "font/woff" : "font/ttf",
  })
  assert.equal(
    await inlineFonts(rules, fetchFont),
    [
      `@font-face{font-family:"X";src:url(data:font/woff;base64,AA==) format("woff")}`,
      `@font-face{font-family:"Z";src:url(data:font/ttf;base64,AA==) format("truetype")}`,
    ].join("\n"),
  )
})
