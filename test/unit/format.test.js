import { test } from "node:test"
import assert from "node:assert/strict"
import {
  formatLines,
  formatDate,
  formatDuration,
  programLabel,
  userLabel,
} from "../../src/format.js"

test("formatLines groups ranges by program and collapses single lines", () => {
  assert.equal(
    formatLines([
      { from: 1, to: 3, program: "main" },
      { from: 10, to: 12, program: "main" },
      { from: 20, to: 20, program: "helper" },
    ]),
    "main: lines 1-3, 10-12; helper: line 20",
  )
  assert.equal(formatLines([]), "no line information")
  assert.equal(formatLines(undefined), "no line information")
})

test("formatDuration rounds to minutes and hours", () => {
  assert.equal(
    formatDuration("2026-10-16T10:00:00Z", "2026-10-16T10:00:30Z"),
    "under a minute",
  )
  assert.equal(
    formatDuration("2026-10-16T10:00:00Z", "2026-10-16T10:04:10Z"),
    "4 min",
  )
  assert.equal(
    formatDuration("2026-10-16T10:00:00Z", "2026-10-16T11:12:00Z"),
    "1 h 12 min",
  )
})

test("formatDate renders a parseable local date and programLabel prefers the label", () => {
  assert.match(formatDate("2026-10-16T10:04:10Z"), /2026/)
  assert.equal(
    programLabel({ label: "Sleep study", gt_key: "abc1234" }),
    "Sleep study",
  )
  assert.equal(programLabel({ label: "", gt_key: "abc1234" }), "abc1234")
  assert.equal(programLabel({ label: null, gt_key: "abc1234" }), "abc1234")
})

test("userLabel prefers the GitHub username, then the email, then a generic label", () => {
  assert.equal(
    userLabel({
      email: "dev@example.com",
      user_metadata: { user_name: "octocat", preferred_username: "octo" },
    }),
    "octocat",
  )
  assert.equal(
    userLabel({
      email: "dev@example.com",
      user_metadata: { preferred_username: "octo" },
    }),
    "octo",
  )
  assert.equal(
    userLabel({ email: "dev@example.com", user_metadata: {} }),
    "dev@example.com",
  )
  assert.equal(userLabel({ email: "dev@example.com" }), "dev@example.com")
  assert.equal(userLabel({ user_metadata: { user_name: "  " } }), "Signed in")
  assert.equal(userLabel({}), "Signed in")
})
