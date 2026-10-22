// Credentials for the command line, from the process environment first and a
// .env file second. The file parser accepts the forms people actually write:
// bare values, double or single quotes, and a leading "export".
import { existsSync, readFileSync } from "node:fs"

export function parseEnv(text) {
  const values = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      value.length >= 2 &&
      value[0] === value[value.length - 1] &&
      (value[0] === '"' || value[0] === "'")
    ) {
      value = value.slice(1, -1)
    }
    values[match[1]] = value
  }
  return values
}

export function readEnvFile(file) {
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {}
}

function pair(env, file, emailKey, passwordKey) {
  const email = env[emailKey] || file[emailKey]
  const password = env[passwordKey] || file[passwordKey]
  return email && password ? { email, password } : null
}

export function credentials(env, file) {
  return {
    harness: pair(
      env,
      file,
      "GT_FEEDBACK_HARNESS_EMAIL",
      "GT_FEEDBACK_HARNESS_PASSWORD",
    ),
    guidedtrack: pair(env, file, "GT_EMAIL", "GT_PASSWORD"),
  }
}
