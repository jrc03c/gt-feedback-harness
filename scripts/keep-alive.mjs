// Weekly ping so the free-tier project is never paused for inactivity.
// Uses the public publishable key. The programs table grants nothing to the
// anon role, so a healthy project answers 401 (permission denied): any
// response below 500 proves the API and database are up.
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY are required")
  process.exit(2)
}
// Publishable keys travel in the apikey header only (they are not JWTs).
const response = await fetch(`${url}/rest/v1/programs?select=id&limit=1`, {
  headers: { apikey: key },
})
console.log(`keep-alive: ${response.status}`)
if (response.status >= 500) process.exit(1)
