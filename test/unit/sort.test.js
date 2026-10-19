import { test } from "node:test"
import assert from "node:assert/strict"
import { sortSessions, SORT_COLUMNS } from "../../src/screens/inbox-sort.js"

const session = (id, overrides) => ({
  id,
  reviewer_name: "",
  mode: "run",
  started_at: "2026-10-16T01:00:00Z",
  last_seen_at: "2026-10-16T01:05:00Z",
  item_count: 0,
  unresolved_count: 0,
  ...overrides,
})

const alice = session("a", {
  reviewer_name: "alice",
  mode: "test",
  started_at: "2026-10-16T01:00:00Z",
  last_seen_at: "2026-10-16T01:30:00Z",
  item_count: 3,
  unresolved_count: 2,
})
const bob = session("b", {
  reviewer_name: "Bob",
  started_at: "2026-10-16T03:00:00Z",
  last_seen_at: "2026-10-16T03:01:00Z",
  item_count: 5,
  unresolved_count: 0,
})
const anon = session("c", {
  started_at: "2026-10-16T02:00:00Z",
  last_seen_at: "2026-10-16T02:10:00Z",
  item_count: 1,
  unresolved_count: 1,
})
const sessions = [alice, bob, anon]
const ids = list => list.map(s => s.id)

test("the sortable columns are the table's columns", () => {
  assert.deepEqual(SORT_COLUMNS, [
    "reviewer",
    "mode",
    "started",
    "duration",
    "feedback",
  ])
})

test("started sorts by date, newest first when descending", () => {
  assert.deepEqual(ids(sortSessions(sessions, "started", "desc")), [
    "b",
    "c",
    "a",
  ])
  assert.deepEqual(ids(sortSessions(sessions, "started", "asc")), [
    "a",
    "c",
    "b",
  ])
})

test("reviewer sorts case-insensitively with anonymous sessions last", () => {
  assert.deepEqual(ids(sortSessions(sessions, "reviewer", "asc")), [
    "a",
    "b",
    "c",
  ])
  assert.deepEqual(ids(sortSessions(sessions, "reviewer", "desc")), [
    "c",
    "b",
    "a",
  ])
})

test("mode sorts by the mode string", () => {
  assert.deepEqual(ids(sortSessions(sessions, "mode", "asc")), ["b", "c", "a"])
})

test("duration sorts by how long the session lasted", () => {
  assert.deepEqual(ids(sortSessions(sessions, "duration", "asc")), [
    "b",
    "c",
    "a",
  ])
})

test("feedback sorts by unresolved items, then by total items", () => {
  assert.deepEqual(ids(sortSessions(sessions, "feedback", "desc")), [
    "a",
    "c",
    "b",
  ])
  assert.deepEqual(ids(sortSessions(sessions, "feedback", "asc")), [
    "b",
    "c",
    "a",
  ])
})

test("ties fall back to newest first and the input is not mutated", () => {
  const copy = [...sessions]
  const sorted = sortSessions(sessions, "mode", "desc")
  assert.deepEqual(ids(sorted), ["a", "b", "c"])
  assert.deepEqual(sessions, copy)
})
