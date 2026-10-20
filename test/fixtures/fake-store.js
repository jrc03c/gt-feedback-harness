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
  const notFound = () =>
    Object.assign(new Error("Row not found"), { code: "PGRST116" })
  const requireUser = () => {
    if (!state.user) throw new Error("Not signed in")
  }

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
    emitAuth() {
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
      requireUser()
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
      if (!session) return
      session.last_seen_at = now()
      if (reviewerName !== undefined) session.reviewer_name = reviewerName
    },
    async sendItem(sessionId, item) {
      record("sendItem")
      if (!state.sessions.some(row => row.id === sessionId)) {
        throw Object.assign(
          new Error("new row violates row-level security policy"),
          { code: "42501" },
        )
      }
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
      return [...state.programs]
        .sort(
          (a, b) =>
            (b.created_at ?? "").localeCompare(a.created_at ?? "") ||
            b.id.localeCompare(a.id),
        )
        .map(overview)
    },
    async getProgram(programId) {
      const program = state.programs.find(p => p.id === programId)
      if (!program) throw notFound()
      return overview(program)
    },
    async registerProgram({ gtKey, label }) {
      record("registerProgram")
      requireUser()
      if (
        state.programs.some(
          p => p.owner_id === state.user.id && p.gt_key === gtKey.trim(),
        )
      ) {
        throw Object.assign(
          new Error("duplicate key value violates unique constraint"),
          { code: "23505" },
        )
      }
      const program = {
        id: uuid(),
        owner_id: state.user.id,
        gt_key: gtKey.trim(),
        label: (label || "").trim() || null,
        share_id: ("S" + ++counter).padEnd(24, "S"),
        created_at: now(),
      }
      state.programs.push(program)
      return program
    },
    async renameProgram(programId, label) {
      record("renameProgram")
      const program = state.programs.find(p => p.id === programId)
      program.label = (label || "").trim() || null
      return program.label
    },
    async regenerateShare(programId) {
      record("regenerateShare")
      const program = state.programs.find(p => p.id === programId)
      program.share_id = ("R" + ++counter).padEnd(24, "R")
      return program.share_id
    },
    async deleteProgram(programId) {
      record("deleteProgram")
      for (const s of state.sessions.filter(s => s.program_id === programId)) {
        await store.deleteSession(s.id)
      }
      state.programs = state.programs.filter(p => p.id !== programId)
    },
    async listSessions(programId) {
      record("listSessions")
      return state.sessions
        .filter(s => s.program_id === programId)
        .sort(
          (a, b) =>
            b.started_at.localeCompare(a.started_at) ||
            b.id.localeCompare(a.id),
        )
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
      if (!session) throw notFound()
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
      if (!state.screenshots.has(path)) {
        throw Object.assign(new Error("Object not found"), { code: "404" })
      }
      return state.screenshots.get(path)
    },
    async setResolved(itemId, resolved) {
      record(`setResolved:${resolved}`)
      const item = state.items.find(i => i.id === itemId)
      if (item) item.resolved_at = resolved ? now() : null
    },
    async deleteSession(sessionId) {
      record("deleteSession")
      state.sessions = state.sessions.filter(s => s.id !== sessionId)
      state.items = state.items.filter(i => i.session_id !== sessionId)
      for (const path of [...state.screenshots.keys()]) {
        if (path.startsWith(`${sessionId}/`)) state.screenshots.delete(path)
      }
    },
  }
  return store
}
