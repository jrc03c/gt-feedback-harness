// Resolves the database connection string for local tools. SUPABASE_DB_URL
// wins when set; otherwise it is built from the git-ignored .env file, whose
// SUPABASE_DB_URL_TEMPLATE holds a literal [YOUR-PASSWORD] placeholder and
// whose SUPABASE_DB_PASSWORD holds the raw password (simple KEY=value lines).
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export function readEnvFile(file = path.join(root, ".env")) {
  const values = {}
  if (!existsSync(file)) return values
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (match) values[match[1]] = match[2].trim()
  }
  return values
}

export function databaseUrl(env = process.env, file) {
  if (env.SUPABASE_DB_URL) return env.SUPABASE_DB_URL
  const values = readEnvFile(file)
  const template = values.SUPABASE_DB_URL_TEMPLATE
  const password = values.SUPABASE_DB_PASSWORD
  if (!template || !password) return null
  if (!template.includes("[YOUR-PASSWORD]")) {
    throw new Error(
      "SUPABASE_DB_URL_TEMPLATE in .env must contain the literal placeholder [YOUR-PASSWORD]",
    )
  }
  return template.replace("[YOUR-PASSWORD]", encodeURIComponent(password))
}
