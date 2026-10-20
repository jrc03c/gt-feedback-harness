# Backlog

Ideas we have decided not to build yet, with enough context to pick them up later.

## Image proxy for screenshots

Images served without an `Access-Control-Allow-Origin` header (for example `https://www.rd.com/...jpg` in the Kitchen Sink program) cannot be read by the screenshot library, because the page is drawn into an SVG and every image must be fetched and inlined first. Such images are currently drawn as gray boxes of the same size (see `src/capture.js`). The fonts in `gt-fonts.css` work around the same limitation for GuidedTrack's icon fonts.

The generic fix is a proxy we control: a Supabase Edge Function that fetches an image server-side and returns it with the header. The capture would try the direct fetch first and fall back to the proxy through the library's `fetchFn` option, so images that already allow cross-origin reads stay fast.

Requirements when we build it:

- Lock it down so it is not an open proxy: require the harness's own Supabase session token, accept only image content types, cap the response size, and time out slow hosts.
- Deploying an Edge Function needs a Supabase access token (with the functions scope) in CI, which the deploy workflow no longer has; a manual deploy from the dashboard would also do, since the function would rarely change.
- Proxied bytes count against the project's bandwidth.
- It cannot help with images that need the reviewer's cookies.

Alternatives considered and rejected for the default path: html2canvas has the same limitation (its `proxy` option is this same proxy); the Screen Capture API avoids CORS entirely but prompts the reviewer on every capture and does not exist on phones.
