// The slice of GuidedTrack's own API the setup command needs: finding a
// program and adding a URL to its Publish page. Authenticates with HTTP Basic
// auth, which GuidedTrack accepts without a CSRF token (verified 2026-10-22).
const PER_PAGE = 50

export function createGuidedTrack({
  email,
  password,
  fetch = globalThis.fetch,
  host = "https://www.guidedtrack.com",
}) {
  const auth = "Basic " + Buffer.from(`${email}:${password}`).toString("base64")

  async function call(method, path, body) {
    const init = {
      method,
      headers: { Authorization: auth, Accept: "application/json" },
    }
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json"
      init.body = JSON.stringify(body)
    }
    const response = await fetch(host + path, init)
    if (!response.ok) {
      throw new Error(
        `GuidedTrack ${method} ${path} failed: ${response.status}`,
      )
    }
    return response.json()
  }

  return {
    // A program by exact name (through the name search) or by key (by paging
    // through the whole list, since the search only looks at names).
    async findProgram(term) {
      const byName = await call(
        "GET",
        `/programs.json?query=${encodeURIComponent(term)}`,
      )
      const named = byName.find(p => p.name === term)
      if (named) return named
      for (let page = 1; ; page++) {
        const batch = await call("GET", `/programs.json?page=${page}`)
        const keyed = batch.find(p => p.key === term)
        if (keyed) return keyed
        if (batch.length === 0 || batch.length < PER_PAGE) return null
      }
    },
    async listPages(programId) {
      return (await call("GET", `/programs/${programId}/pages`)).pages
    },
    // Adds the url to the program's Publish page unless it is already there.
    async allowPage(programId, url) {
      const pages = await this.listPages(programId)
      if (pages.some(p => p.url === url)) return false
      await call("POST", `/programs/${programId}/pages`, { page: { url } })
      return true
    },
  }
}
