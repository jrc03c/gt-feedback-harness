// A stand-in for a supabase-js client. Every builder call is recorded, and
// awaiting a chain resolves with the canned response registered for
// "<kind>:<name>" (a value or a function of the recorded call).
export function createFakeSupabase(responses = {}, authState = {}) {
  const calls = []

  function chain(kind, name, initialSteps = []) {
    const record = { kind, name, steps: [...initialSteps] }
    calls.push(record)
    const proxy = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === "then") {
          const response = responses[`${kind}:${name}`] ?? {
            data: null,
            error: null,
          }
          const value =
            typeof response === "function" ? response(record) : response
          return (resolve, reject) =>
            Promise.resolve(value).then(resolve, reject)
        }
        return (...args) => {
          record.steps.push([prop, args])
          return proxy
        }
      },
    })
    return proxy
  }

  let user = authState.user ?? null
  const listeners = []
  return {
    calls,
    stepsOf(kind, name) {
      return calls
        .filter(c => c.kind === kind && c.name === name)
        .map(c => c.steps)
    },
    from: table => chain("from", table),
    rpc: (fn, args) => chain("rpc", fn, [["args", [args]]]),
    storage: { from: bucket => chain("storage", bucket) },
    auth: {
      async getSession() {
        return { data: { session: user ? { user } : null }, error: null }
      },
      async signInAnonymously() {
        user = { id: "anon-uid", is_anonymous: true }
        return { data: { user }, error: null }
      },
      async signInWithOAuth(options) {
        calls.push({
          kind: "auth",
          name: "signInWithOAuth",
          steps: [["options", [options]]],
        })
        return { data: {}, error: null }
      },
      async signInWithPassword(credentials) {
        calls.push({
          kind: "auth",
          name: "signInWithPassword",
          steps: [["credentials", [credentials]]],
        })
        user = { id: "password-uid", email: credentials.email }
        return { data: { user, session: { user } }, error: null }
      },
      async updateUser(attributes) {
        calls.push({
          kind: "auth",
          name: "updateUser",
          steps: [["attributes", [attributes]]],
        })
        return { data: { user }, error: null }
      },
      async signOut() {
        calls.push({ kind: "auth", name: "signOut", steps: [] })
        user = null
        return { error: null }
      },
      onAuthStateChange(fn) {
        listeners.push(fn)
        return { data: { subscription: { unsubscribe() {} } } }
      },
      emit(session) {
        for (const fn of listeners) fn("SIGNED_IN", session)
      },
    },
  }
}
