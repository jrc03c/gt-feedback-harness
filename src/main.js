import "./styles.css"
import { parseRoute } from "./router.js"
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "./config.js"
import { createStore } from "./store.js"
import { runReviewer } from "./screens/reviewer-flow.js"
import { mountDeveloper } from "./screens/developer.js"
import { mountInbox } from "./screens/inbox.js"
import { mountSession } from "./screens/session.js"
import { renderErrorBanner } from "./screens/banners.js"

const root = document.getElementById("app")
const route = parseRoute(window.location.search)

if (!isConfigured()) {
  renderErrorBanner(
    root,
    "This harness has no backend configured. Set the Supabase URL and publishable key in src/config.js.",
  )
} else {
  const store = createStore({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY })
  const screens = {
    reviewer: () => runReviewer({ root, route, store }),
    developer: () => mountDeveloper({ root, store }),
    inbox: () => mountInbox({ root, store, programId: route.programId }),
    session: () => mountSession({ root, store, sessionId: route.sessionId }),
  }
  screens[route.screen]().catch(error => renderErrorBanner(root, error.message))
}
