// Copies the @font-face rules out of GuidedTrack's stylesheets into one file
// the harness serves itself, with each font file inlined as a data URL.
// GuidedTrack sends its stylesheets without cross-origin headers, so the
// screenshot library cannot read their rules and left the icon fonts out of
// captures. The capture hands the library this CSS instead; the library
// pastes it into the screenshot as is, which is why the font data must
// already be inline. The deploy workflow runs this on every deploy and once a
// week.
//
//   node scripts/gt-fonts.mjs <output file>
import { writeFileSync } from "node:fs"
import { GT_ASSET_BASE } from "../src/gt-embed.js"

export const STYLESHEETS = ["bootstrap.css", "guidedtrack.css"]

// Returns the @font-face rules in cssText, with every url() made absolute
// against the stylesheet's own URL, joined by newlines.
export function extractFontFaces(cssText, stylesheetUrl) {
  const rules = cssText.match(/@font-face\s*{[^}]*}/g) || []
  return rules
    .map(rule =>
      rule.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (match, quote, url) =>
        /^(data:|[a-z][a-z0-9+.-]*:)/i.test(url)
          ? match
          : `url(${quote}${new URL(url, stylesheetUrl).href}${quote})`,
      ),
    )
    .join("\n")
}

const FORMATS = {
  woff2: "woff2",
  woff: "woff",
  ttf: "truetype",
  otf: "opentype",
  eot: "embedded-opentype",
  svg: "svg",
}
const PREFERENCE = ["woff2", "woff"]

function sourcesOf(rule) {
  const sources = []
  for (const src of rule.matchAll(/src\s*:([^;}]*)/g)) {
    for (const part of src[1].split(",")) {
      const url = part.match(/url\(\s*(["']?)([^"')]+)\1\s*\)/)
      if (!url) continue
      const hint = part.match(/format\(\s*["']?([a-z0-9-]+)["']?\s*\)/i)
      const extension = (url[2].split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) ||
        [])[1]
      const format =
        hint?.[1].toLowerCase() || FORMATS[extension?.toLowerCase()] || "woff2"
      sources.push({ url: url[2], format })
    }
  }
  return sources
}

// Rewrites each @font-face rule to a single data-URL source: the woff2 file
// when there is one, otherwise woff, otherwise the first source. fetchFont(url)
// must resolve to { bytes, type }.
export async function inlineFonts(cssText, fetchFont) {
  const rules = cssText.match(/@font-face\s*{[^}]*}/g) || []
  const out = []
  for (const rule of rules) {
    const sources = sourcesOf(rule)
    if (sources.length === 0) continue
    const chosen =
      PREFERENCE.map(f => sources.find(s => s.format === f)).find(Boolean) ||
      sources[0]
    const { bytes, type } = await fetchFont(chosen.url)
    const data = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`
    let body = rule.slice(rule.indexOf("{") + 1, rule.lastIndexOf("}"))
    body = body.replace(/src\s*:[^;}]*;?/g, "").trim()
    if (body && !body.endsWith(";")) body += ";"
    out.push(`@font-face{${body}src:url(${data}) format("${chosen.format}")}`)
  }
  return out.join("\n")
}

async function fetchFont(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const extension = (url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1]
  const type =
    response.headers.get("content-type")?.split(";")[0] ||
    `font/${extension || "woff2"}`
  return { bytes: new Uint8Array(await response.arrayBuffer()), type }
}

async function main(output) {
  if (!output) throw new Error("Usage: node scripts/gt-fonts.mjs <output file>")
  const parts = []
  for (const file of STYLESHEETS) {
    const url = `${GT_ASSET_BASE}/${file}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    const rules = extractFontFaces(await response.text(), url)
    if (!rules) throw new Error(`${url}: no @font-face rules found`)
    parts.push(await inlineFonts(rules, fetchFont))
  }
  const css = parts.join("\n") + "\n"
  writeFileSync(output, css)
  console.log(
    `Wrote ${output}: ${(css.match(/@font-face/g) || []).length} @font-face rules, ${Math.round(css.length / 1024)} KB`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main(process.argv[2]).catch(error => {
    console.error(error.message)
    process.exit(1)
  })
}
