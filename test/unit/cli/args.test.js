import { test } from "node:test"
import assert from "node:assert/strict"
import { parseArgs } from "../../../src/cli/args.js"

test("parseArgs splits the command, positionals, and flags", () => {
  assert.deepEqual(
    parseArgs(["setup", "My Program", "--label", "Nice name", "--out", "dir"]),
    {
      command: "setup",
      positional: ["My Program"],
      flags: { label: "Nice name", out: "dir" },
    },
  )
})

test("parseArgs treats a flag without a value as a boolean", () => {
  assert.deepEqual(parseArgs(["feedback", "abc1234", "--all"]), {
    command: "feedback",
    positional: ["abc1234"],
    flags: { all: true },
  })
})

test("parseArgs with nothing asks for help", () => {
  assert.deepEqual(parseArgs([]), {
    command: "help",
    positional: [],
    flags: {},
  })
  assert.equal(parseArgs(["--help"]).command, "help")
})
