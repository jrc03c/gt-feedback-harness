// The Supabase publishable key (sb_publishable_...) is public by design: it
// only grants what the row-level security policies allow. It keeps the name
// SUPABASE_ANON_KEY for compatibility. Secret keys (sb_secret_...) never go
// here, and isConfigured() refuses one if it is pasted by mistake.
export const SUPABASE_URL = "https://rubbnzscqjsoipfhmwgj.supabase.co"
export const SUPABASE_ANON_KEY =
  "sb_publishable_y3sWX2tUdd64rrl6-EMpxQ_8Nnc6CZ1"
export const OAUTH_PROVIDER = "github"
// Where the harness is published; the command line adds it to programs'
// Publish pages and builds reviewer links from it.
export const HARNESS_PAGE_URL = "https://jrc03c.github.io/gt-feedback-harness/"

export function isConfiguredValue(url, key) {
  return (
    typeof url === "string" &&
    typeof key === "string" &&
    /^https:\/\/[a-z]+\.supabase\.co$/.test(url) &&
    /^sb_publishable_[A-Za-z0-9_-]+$/.test(key)
  )
}

export function isConfigured() {
  return isConfiguredValue(SUPABASE_URL, SUPABASE_ANON_KEY)
}
