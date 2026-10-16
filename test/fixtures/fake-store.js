// In-memory stand-in for src/store.js so screen tests never touch the network.
// Row shapes mirror the database columns.
export function createFakeStore(seed = {}) {
  const state = {
    user: seed.user ?? null,
    programs: seed.programs ?? [],
    sessions: seed.sessions ?? [],
    items: seed.items ?? [],
    screenshots: new Map(),
  }
  const calls = []
  const listeners = []
  let counter = 0
  const uuid = () =>
    `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`
  const now = () => new Date().toISOString()
  const notify = () => listeners.forEach(fn => fn(state.user))
  const record = name => calls.push(name)

  const overview = program => {
    const sessions = state.sessions.filter(s => s.program_id === program.id)
    const sessionIds = new Set(sessions.map(s => s.id))
    const unresolved = state.items.filter(
      i => sessionIds.has(i.session_id) && !i.resolved_at,
    ).length
    return {
      ...program,
      session_count: sessions.length,
      unresolved_count: unresolved,
    }
  }

  const store = {
    state,
    calls,
    async signInAnonymously() {
      record("signInAnonymously")
      if (!state.user) state.user = { id: "anon-1", is_anonymous: true }
      return state.user
    },
    async getUser() {
      return state.user
    },
    async signInWithProvider(provider, redirectTo) {
      record(`signInWithProvider:${provider}:${redirectTo}`)
      state.user = {
        id: "dev-1",
        email: "dev@example.com",
        is_anonymous: false,
      }
      notify()
    },
    async signOut() {
      record("signOut")
      state.user = null
      notify()
    },
    onAuthChange(fn) {
      listeners.push(fn)
      return { unsubscribe: () => listeners.splice(listeners.indexOf(fn), 1) }
    },
    async resolveShare(shareId) {
      record(`resolveShare:${shareId}`)
      const program = state.programs.find(p => p.share_id === shareId)
      return program ? { programId: program.id, gtKey: program.gt_key } : null
    },
    async createSession({
      programId,
      shareId,
      mode,
      reviewerName = "",
      userAgent,
      viewport,
    }) {
      record("createSession")
      const session = {
        id: uuid(),
        program_id: programId,
        share_id: shareId,
        reviewer_uid: state.user.id,
        reviewer_name: reviewerName,
        mode,
        user_agent: userAgent,
        viewport,
        started_at: now(),
        last_seen_at: now(),
      }
      state.sessions.push(session)
      return session.id
    },
    async touchSession(sessionId, { reviewerName } = {}) {
      record(`touchSession:${reviewerName ?? ""}`)
      const session = state.sessions.find(s => s.id === sessionId)
      session.last_seen_at = now()
      if (reviewerName !== undefined) session.reviewer_name = reviewerName
    },
    async sendItem(sessionId, item) {
      record("sendItem")
      const id = uuid()
      const path = `${sessionId}/${id}.webp`
      state.screenshots.set(path, item.image.blob)
      state.items.push({
        id,
        session_id: sessionId,
        created_at: now(),
        text: item.text,
        annotations: item.annotations,
        context: item.context,
        screenshot_path: path,
        image_size: {
          width: item.image.width,
          height: item.image.height,
          scale: item.image.scale,
        },
        resolved_at: null,
      })
      return id
    },
    async listPrograms() {
      record("listPrograms")
      return state.programs.map(overview)
    },
    async getProgram(programId) {
      return overview(state.programs.find(p => p.id === programId))
    },
    async registerProgram({ gtKey, label }) {
      record("registerProgram")
      const program = {
        id: uuid(),
        owner_id: state.user.id,
        gt_key: gtKey.trim(),
        label: (label || "").trim() || null,
        share_id: "S".repeat(24),
        created_at: now(),
      }
      state.programs.push(program)
      return program
    },
    async regenerateShare(programId) {
      record("regenerateShare")
      const program = state.programs.find(p => p.id === programId)
      program.share_id = "R".repeat(24)
      return program.share_id
    },
    async deleteProgram(programId) {
      record("deleteProgram")
      state.programs = state.programs.filter(p => p.id !== programId)
    },
    async listSessions(programId) {
      record("listSessions")
      return state.sessions
        .filter(s => s.program_id === programId)
        .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
        .map(s => {
          const items = state.items.filter(i => i.session_id === s.id)
          return {
            ...s,
            item_count: items.length,
            unresolved_count: items.filter(i => !i.resolved_at).length,
          }
        })
    },
    async getSession(sessionId) {
      const session = state.sessions.find(s => s.id === sessionId)
      const program = state.programs.find(p => p.id === session.program_id)
      return {
        ...session,
        programs: { gt_key: program.gt_key, label: program.label },
      }
    },
    async listItems(sessionId) {
      record("listItems")
      return state.items.filter(i => i.session_id === sessionId)
    },
    async downloadScreenshot(path) {
      record("downloadScreenshot")
      return state.screenshots.get(path)
    },
    async setResolved(itemId, resolved) {
      record(`setResolved:${resolved}`)
      state.items.find(i => i.id === itemId).resolved_at = resolved
        ? now()
        : null
    },
    async deleteSession(sessionId) {
      record("deleteSession")
      state.sessions = state.sessions.filter(s => s.id !== sessionId)
      state.items = state.items.filter(i => i.session_id !== sessionId)
    },
  }
  return store
}
