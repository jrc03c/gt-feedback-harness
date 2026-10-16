// The Supabase anon key is public by design: it only grants what the
// row-level security policies allow. The service role key never goes here.
export const SUPABASE_URL = "https://REPLACE.supabase.co"
export const SUPABASE_ANON_KEY = "REPLACE"
export const OAUTH_PROVIDER = "google"

export function isConfigured() {
  return (
    SUPABASE_URL.startsWith("https://") &&
    !SUPABASE_URL.includes("REPLACE") &&
    SUPABASE_ANON_KEY.length > 20 &&
    SUPABASE_ANON_KEY !== "REPLACE"
  )
}
