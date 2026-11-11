import http from "node:http"
import { createReadStream, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
}

// With `proxy: true` the server also answers /proxy?url=... by fetching that
// URL itself and returning the bytes with a CORS header, the way a public
// image proxy does. Every proxied URL is recorded in `requests`.
export function startServer({ proxy = false } = {}) {
  const requests = []
  return new Promise(resolve => {
    const server = http.createServer(async (request, response) => {
      const url = new URL(request.url, "http://localhost")

      if (proxy && url.pathname === "/proxy") {
        const target = url.searchParams.get("url")
        requests.push(target)
        try {
          const upstream = await fetch(target)
          if (!upstream.ok) throw new Error(`upstream ${upstream.status}`)
          response.writeHead(200, {
            "content-type": upstream.headers.get("content-type"),
            "access-control-allow-origin": "*",
          })
          return response.end(Buffer.from(await upstream.arrayBuffer()))
        } catch {
          response.writeHead(502, { "access-control-allow-origin": "*" })
          return response.end("bad gateway")
        }
      }

      const file = path.join(ROOT, decodeURIComponent(url.pathname))

      if (!file.startsWith(ROOT)) {
        response.writeHead(403)
        return response.end()
      }

      let stat
      try {
        stat = statSync(file)
      } catch {
        response.writeHead(404)
        return response.end("not found")
      }

      if (stat.isDirectory()) {
        response.writeHead(404)
        return response.end("not found")
      }

      response.writeHead(200, {
        "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      })
      createReadStream(file).pipe(response)
    })

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise(done => server.close(done)),
      })
    })
  })
}
