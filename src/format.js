export function formatLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return "no line information"
  const byProgram = new Map()
  for (const line of lines) {
    const program = line.program || "main"
    if (!byProgram.has(program)) byProgram.set(program, [])
    byProgram.get(program).push(line)
  }
  return Array.from(byProgram, ([program, ranges]) => {
    const parts = ranges.map(({ from, to }) =>
      from === to ? `${from}` : `${from}-${to}`,
    )
    const word =
      ranges.length === 1 && ranges[0].from === ranges[0].to ? "line" : "lines"
    return `${program}: ${word} ${parts.join(", ")}`
  }).join("; ")
}

export function formatDate(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "unknown time"
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function formatDuration(startIso, endIso) {
  const minutes = Math.floor((new Date(endIso) - new Date(startIso)) / 60000)
  if (!Number.isFinite(minutes) || minutes < 1) return "under a minute"
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export function programLabel(program) {
  return program.label ? program.label : program.gt_key
}
