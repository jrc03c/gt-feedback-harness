export function parseRoute(search) {
  const params = new URLSearchParams(search)
  const value = name => (params.get(name) || "").trim()

  const sessionId = value("session")
  if (sessionId) return { screen: "session", sessionId }

  const shareId = value("r")
  if (shareId) {
    return {
      screen: "reviewer",
      shareId,
      mode: params.get("mode") === "test" ? "test" : "run",
      name: value("name"),
      // capture=screen tries the Screen Capture API before the DOM capture.
      capture: params.get("capture") === "screen" ? "screen" : "dom",
    }
  }

  if (params.has("account")) return { screen: "account" }

  const programId = value("program")
  if (programId) return { screen: "inbox", programId }

  return { screen: "developer" }
}
