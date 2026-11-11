# Backlog

Ideas we have decided not to build yet, with enough context to pick them up later.

## Self-hosted image proxy for screenshots

Images served without an `Access-Control-Allow-Origin` header (for example `https://www.rd.com/...jpg` in the Kitchen Sink program) cannot be read by the screenshot library, because the page is drawn into an SVG and every image must be fetched and inlined first. The capture tries the direct fetch first and falls back to the public image proxy wsrv.nl through the library's `fetchFn` option (see `src/image-proxy.js`); images it cannot get either way are drawn as gray boxes of the same size. The fonts in `gt-fonts.css` work around the same limitation for GuidedTrack's icon fonts.

wsrv.nl has run since 2007, is privately funded at very low cost, and allows 2,500 uncached requests per 10 minutes per IP, but it is a volunteer service with no SLA. If it goes away or becomes unsuitable, the replacement is a proxy we control: a Supabase Edge Function that fetches an image server-side and returns it with the header, or a self-hosted copy of wsrv.nl's own BSD-licensed code. Swapping the URL in `src/image-proxy.js` is the only code change, provided the replacement accepts `?url=`.

Requirements when we build our own:

- Lock it down so it is not an open proxy: accept only image content types, cap the response size, time out slow hosts, and rate-limit per user and IP. Requiring the harness's Supabase session token helps little on its own, since anyone with the public key can sign in anonymously.
- Refuse private, loopback, and link-local addresses, allow only `http` and `https`, and re-check every redirect, so the function cannot be used to reach the project's own network or cloud metadata endpoints.
- Serve responses with `X-Content-Type-Options: nosniff` and the fetched image's content type only.
- Deploying an Edge Function needs a Supabase access token (with the functions scope) in CI, which the deploy workflow no longer has; a manual deploy from the dashboard would also do, since the function would rarely change.
- Proxied bytes count against the project's bandwidth, twice (download and re-serve).
- It cannot help with images that need the reviewer's cookies, any more than wsrv.nl can.

Alternatives considered and rejected for the default path: html2canvas has the same limitation (its `proxy` option is this same proxy); the Screen Capture API avoids CORS entirely but prompts the reviewer on every capture and does not exist on phones.
