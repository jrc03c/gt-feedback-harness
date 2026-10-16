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
  try {
    await store.signInAnonymously()
  } catch (error) {
    renderErrorBanner(
      root,
      `The feedback backend is unavailable: ${error.message}. Tell the developer.`,
    )
    return
  }

  const resolved = await store.resolveShare(route.shareId)
  if (!resolved) {
    renderInvalidLinkBanner(root)
    return
  }

  let sessionId = null
  try {
    sessionId = session.getItem(SESSION_KEY(route.shareId))
  } catch {
    sessionId = null
  }
  if (!sessionId) {
    sessionId = await store.createSession({
      programId: resolved.programId,
      shareId: route.shareId,
      mode: route.mode,
      reviewerName: readName(storage),
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    })
    try {
      session.setItem(SESSION_KEY(route.shareId), sessionId)
    } catch {
      // Storage blocked: a reload will start a new session, which is acceptable.
    }
  }

  const heartbeat = setInterval(() => {
    store.touchSession(sessionId).catch(() => {})
  }, heartbeatMs)
  window.addEventListener("pagehide", () => clearInterval(heartbeat), {
    once: true,
  })

  await mountReviewer({
    root,
    route: { key: resolved.gtKey, mode: route.mode },
    assetBase,
    storage,
    sendFeedback: async item => {
      await store.touchSession(sessionId, {
        reviewerName: item.reviewerName || "",
      })
      await store.sendItem(sessionId, item)
    },
  })
}
