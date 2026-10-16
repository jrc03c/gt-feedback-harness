// Runs every supabase/tests/*.sql file against the project database using the
// pg package, so policy tests work without Docker. Each file wraps itself in
// begin/rollback, and pgTAP returns TAP lines as query result rows.
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import pg from "pg"
import { databaseUrl } from "./db-url.mjs"

const dir = process.argv[2] || "supabase/tests"
const url = databaseUrl()
if (!url) {
  console.error(
    "SUPABASE_DB_URL is not set and .env lacks SUPABASE_DB_URL_TEMPLATE and SUPABASE_DB_PASSWORD (use the project's session pooler connection string)",
  )
  process.exit(2)
}

// Errors print only their code and message: a pg error object can carry
// connection details, and the URL holds the database password.
function fail(error) {
  console.error(`pgTAP run failed: ${error.code || "error"}: ${error.message}`)
  process.exit(1)
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})
let failed = 0
try {
  await client.connect()
} catch (error) {
  fail(error)
}
try {
  for (const file of readdirSync(dir)
    .filter(f => f.endsWith(".sql"))
    .sort()) {
    console.log(`# ${file}`)
    const results = await client.query(
      readFileSync(path.join(dir, file), "utf8"),
    )
    for (const result of Array.isArray(results) ? results : [results]) {
      for (const row of result.rows || []) {
        const line = Object.values(row)[0]
        if (typeof line !== "string" || line === "") continue
        console.log(line)
        if (line.startsWith("not ok")) failed++
        else if (line.startsWith("# Looks like you planned")) failed++
      }
    }
  }
} catch (error) {
  await client.end().catch(() => {})
  fail(error)
}
await client.end()
if (failed > 0) {
  console.error(`${failed} pgTAP assertion(s) failed`)
  process.exit(1)
}
