// Sorting for the inbox table. Each column has a key function; ties fall back
// to newest first so the order is stable across clicks.
export const SORT_COLUMNS = [
  "reviewer",
  "mode",
  "started",
  "duration",
  "feedback",
]

const KEYS = {
  reviewer: s => (s.reviewer_name || "").trim().toLowerCase(),
  mode: s => s.mode || "",
  started: s => Date.parse(s.started_at) || 0,
  duration: s =>
    (Date.parse(s.last_seen_at) || 0) - (Date.parse(s.started_at) || 0),
  feedback: s => [s.unresolved_count || 0, s.item_count || 0],
}

function compare(a, b) {
  if (Array.isArray(a)) {
    for (let i = 0; i < a.length; i++) {
      const result = compare(a[i], b[i])
      if (result !== 0) return result
    }
    return 0
  }
  return a < b ? -1 : a > b ? 1 : 0
}

function compareReviewer(a, b) {
  // Anonymous sessions sort after every named one (so first when descending).
  const [ka, kb] = [KEYS.reviewer(a), KEYS.reviewer(b)]
  if (ka === "" && kb === "") return 0
  if (ka === "") return 1
  if (kb === "") return -1
  return compare(ka, kb)
}

export function sortSessions(sessions, column, direction = "desc") {
  if (!SORT_COLUMNS.includes(column))
    throw new Error(`Unknown column: ${column}`)
  const sign = direction === "asc" ? 1 : -1
  const key = KEYS[column]
  return [...sessions].sort((a, b) => {
    const primary =
      column === "reviewer" ? compareReviewer(a, b) : compare(key(a), key(b))
    if (primary !== 0) return primary * sign
    return compare(KEYS.started(b), KEYS.started(a)) || compare(b.id, a.id)
  })
}
