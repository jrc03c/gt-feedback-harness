import { mountReviewer, NAME_KEY } from "./reviewer.js"
import { renderInvalidLinkBanner, renderErrorBanner } from "./banners.js"

export const SESSION_KEY = shareId => `harness:session:${shareId}`

function readName(storage) {
  try {
    return storage.getItem(NAME_KEY) || ""
  } catch {
    return ""
  }
}

// True when a send failed because the stored session can no longer take
// items (deleted, or its row is not visible to this reviewer any more).
export function isStaleSessionError(error) {
  if (!error) return false
  if (["42501", "23503", "PGRST116"].includes(error.code)) return true
  if (String(error.statusCode) === "403") return true
  return /row-level security|violates foreign key|not found/i.test(
    error.message || "",
  )
}

// Signs the reviewer in anonymously, turns the share id into a program key,
// creates (or resumes) the session row, and mounts the Phase 1 reviewer
// screen with a sendFeedback that stores items under that session.
export async function runReviewer({
  root,
  route,
  store,
  assetBase,
  storage = window.localStorage,
  session = window.sessionStorage,
  heartbeatMs = 60000,
}) {
  const unavailable = error =>
    renderErrorBanner(
      root,
      `The feedback backend is unavailable: ${error.message}. Tell the developer.`,
    )

  let resolved
  let sessionId = null

  async function startSession() {
    const id = await store.createSession({
      programId: resolved.programId,
      shareId: route.shareId,
      mode: route.mode,
      reviewerName: readName(storage),
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    })
    try {
      session.setItem(SESSION_KEY(route.shareId), id)
    } catch {
      // Storage blocked: a reload will start a new session, which is acceptable.
    }
    return id
  }

  try {
    await store.signInAnonymously()
    resolved = await store.resolveShare(route.shareId)
    if (!resolved) {
      renderInvalidLinkBanner(root)
      return
    }
    try {
      sessionId = session.getItem(SESSION_KEY(route.shareId))
    } catch {
      sessionId = null
    }
    if (!sessionId) sessionId = await startSession()
  } catch (error) {
    unavailable(error)
    return
  }

  const heartbeat = setInterval(() => {
    store.touchSession(sessionId).catch(() => {})
  }, heartbeatMs)
  window.addEventListener("pagehide", () => clearInterval(heartbeat), {
    once: true,
  })

  async function storeItem(item) {
    try {
      await store.touchSession(sessionId, {
        reviewerName: item.reviewerName || "",
      })
    } catch {
      // Best effort: a failed name update must never block a send.
    }
    await store.sendItem(sessionId, item)
  }

  await mountReviewer({
    root,
    route: { key: resolved.gtKey, mode: route.mode },
    assetBase,
    storage,
    sendFeedback: async item => {
      try {
        await storeItem(item)
      } catch (error) {
        // Only a stale session (deleted, or no longer visible) is replaced;
        // anything else is rethrown so the modal offers Retry.
        if (!isStaleSessionError(error)) throw error
        try {
          session.removeItem(SESSION_KEY(route.shareId))
        } catch {
          // Ignore blocked storage.
        }
        sessionId = await startSession()
        await storeItem(item)
      }
    },
  })
}
