import { test } from "node:test"
import assert from "node:assert/strict"
import { extractFontFaces } from "../../scripts/gt-fonts.mjs"

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
