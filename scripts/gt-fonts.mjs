// Copies the @font-face rules out of GuidedTrack's stylesheets into one file
// the harness serves itself. GuidedTrack sends its stylesheets without
// cross-origin headers, so the screenshot library cannot read their rules and
// leaves the icon fonts out of captures; a same-origin copy of the
// declarations fixes that (the font files themselves do allow cross-origin
// fetches). The deploy workflow runs this on every deploy and once a week.
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

async function main(output) {
  if (!output) throw new Error("Usage: node scripts/gt-fonts.mjs <output file>")
  const parts = []
  for (const file of STYLESHEETS) {
    const url = `${GT_ASSET_BASE}/${file}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    const rules = extractFontFaces(await response.text(), url)
    if (!rules) throw new Error(`${url}: no @font-face rules found`)
    parts.push(rules)
  }
  const css = parts.join("\n") + "\n"
  writeFileSync(output, css)
  console.log(
    `Wrote ${output}: ${(css.match(/@font-face/g) || []).length} @font-face rules`,
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
