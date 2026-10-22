import { test } from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"

const BIN = path.resolve("bin/gt-feedback-harness.mjs")

async function run(args, env = {}) {
  const cwd = await mkdtemp(path.join(tmpdir(), "harness-cli-"))
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [BIN, ...args],
      { cwd, env: { PATH: process.env.PATH, ...env } },
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr }
  }
}

test("help lists the commands and the credentials they need", async () => {
  const { code, stdout } = await run(["--help"])
  assert.equal(code, 0)
  for (const word of [
    "setup",
    "programs",
    "sessions",
    "feedback",
    "resolve",
    "unresolve",
  ]) {
    assert.match(stdout, new RegExp(`\\b${word}\\b`))
  }
  assert.match(stdout, /GT_FEEDBACK_HARNESS_EMAIL/)
  assert.match(stdout, /GT_EMAIL/)
})

test("a command without harness credentials fails with a JSON error on stderr", async () => {
  const { code, stdout, stderr } = await run(["programs"])
  assert.equal(code, 1)
  assert.equal(stdout, "")
  const error = JSON.parse(stderr)
  assert.match(error.error, /GT_FEEDBACK_HARNESS_EMAIL/)
})

test("an unknown command is an error", async () => {
  const { code, stderr } = await run(["bogus"])
  assert.equal(code, 1)
  assert.match(JSON.parse(stderr).error, /Unknown command "bogus"/)
})
