// Weekly ping so the free-tier project is never paused for inactivity.
// Uses the public publishable key. The programs table grants nothing to the
// anon role, so a healthy project answers 401 (permission denied): 200, 401
// and 403 prove the API and database are up; anything else fails.
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY
if (!url || !key || key === "undefined") {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY are required")
  process.exit(2)
}
// Publishable keys travel in the apikey header only (they are not JWTs).
const response = await fetch(`${url}/rest/v1/programs?select=id&limit=1`, {
  headers: { apikey: key },
  signal: AbortSignal.timeout(30000),
})
console.log(`keep-alive: ${response.status}`)
if (![200, 401, 403].includes(response.status)) process.exit(1)
