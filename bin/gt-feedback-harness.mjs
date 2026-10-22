#!/usr/bin/env node
// Command line for scripts and agents. Prints JSON on stdout; errors are JSON
// on stderr with exit code 1. See README.md, "For scripts and agents".
import path from "node:path"
import { createClient } from "@supabase/supabase-js"
import { parseArgs } from "../src/cli/args.js"
import { credentials, readEnvFile } from "../src/cli/env.js"
import { createGuidedTrack } from "../src/cli/guidedtrack.js"
import { createFlattener } from "../src/cli/flatten.js"
import { createCommands } from "../src/cli/commands.js"
import { createStore } from "../src/store.js"
import {
  HARNESS_PAGE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "../src/config.js"

const HELP = `Usage: gt-feedback-harness <command> [arguments] [--flags]

Commands
  setup <GuidedTrack program name or key> [--label NAME]
      Allow the harness page on the program's Publish page, register the
      program in the harness if it is new, and print its feedback links.
  programs                       Registered programs with their links.
  sessions <program key or id>   Reviewer sessions of a program.
  feedback <program key or id> [--all] [--out DIR]
      Feedback items (unresolved unless --all) with screenshots written to
      DIR (default "feedback"): raw .webp, overlay .svg, and annotated .png
      (via ImageMagick or Playwright, whichever is installed).
  resolve <item id> | unresolve <item id>

Credentials, from the environment or a .env file in the current directory
  GT_FEEDBACK_HARNESS_EMAIL, GT_FEEDBACK_HARNESS_PASSWORD
      Your harness email and a script password from the harness's account
      page. Needed by every command.
  GT_EMAIL, GT_PASSWORD
      Your GuidedTrack login. Needed by setup to look a program up by name
      and to allow the harness page; without them setup accepts a key only.
  GT_FEEDBACK_HARNESS_URL
      Overrides the harness page URL (default ${HARNESS_PAGE_URL}).
`

const COMMANDS = [
  "setup",
  "programs",
  "sessions",
  "feedback",
  "resolve",
  "unresolve",
]

async function main(argv) {
  const { command, positional, flags } = parseArgs(argv)
  if (command === "help") {
    process.stdout.write(HELP)
    return
  }
  if (!COMMANDS.includes(command)) {
    throw new Error(`Unknown command "${command}". Run with --help.`)
  }
  const env = process.env
  const file = readEnvFile(path.join(process.cwd(), ".env"))
  const { harness, guidedtrack } = credentials(env, file)
  if (!harness) {
    throw new Error(
      "Set GT_FEEDBACK_HARNESS_EMAIL and GT_FEEDBACK_HARNESS_PASSWORD (in the environment or a .env file). Generate the password on the harness's account page.",
    )
  }
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const store = createStore({
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    client,
  })
  const commands = createCommands({
    store,
    guidedtrack: guidedtrack ? createGuidedTrack(guidedtrack) : null,
    pageUrl:
      env.GT_FEEDBACK_HARNESS_URL ||
      file.GT_FEEDBACK_HARNESS_URL ||
      HARNESS_PAGE_URL,
    flatten: createFlattener(),
  })
  const handlers = {
    setup: () =>
      commands.setup(required(positional[0], "a program name or key"), flags),
    programs: () => commands.programs(),
    sessions: () =>
      commands.sessions(required(positional[0], "a program key or id")),
    feedback: () =>
      commands.feedback(required(positional[0], "a program key or id"), flags),
    resolve: () => commands.resolve(required(positional[0], "an item id")),
    unresolve: () => commands.unresolve(required(positional[0], "an item id")),
  }
  await store.signInWithPassword(harness.email, harness.password)
  const result = await handlers[command]()
  process.stdout.write(JSON.stringify(result, null, 2) + "\n")
}

function required(value, what) {
  if (!value) throw new Error(`This command needs ${what}.`)
  return value
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ error: error.message }) + "\n")
  process.exit(1)
})
