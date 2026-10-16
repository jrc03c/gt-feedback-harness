# GuidedTrack Feedback Harness

Embed a GuidedTrack program, screenshot it, draw on the screenshot, type feedback, and send it to the developer. This version (Phase 1) saves each piece of feedback to the reviewer's computer as a single HTML file. Later phases store feedback in Supabase, add a developer inbox, and record sessions for replay.

## Using it

1. On GuidedTrack, open the program's **Publish** page and add the harness URL to the list of pages allowed to run the program. The harness URL is the page's own address, for example `https://<user>.github.io/<repo>/`. Adding it once covers every link below.

2. Open the harness, enter the program key, choose **Test** or **Run**, and click **Open**. Or go straight to `?key=<key>&mode=test`.

3. Click **Give feedback** at any point. Draw with the pen or highlighter, add notes that point at parts of the page, type in the box, and click **Send feedback**. One HTML file downloads. Open it in any browser to see the annotated screenshot, the typed feedback, the program lines that were on screen, and the program's variables. To keep the PNG on its own, right-click the screenshot in that file and save it. The file also embeds the full feedback record as JSON (in the `feedback-sidecar` script element) for tools to read.

"Reset everything" in GuidedTrack's menu works because the harness keeps the program and mode in the query string (the reviewer's name is remembered separately, in the browser). It only brings you back to the harness when you opened the harness at the address you saved on the Publish page, for example `https://<user>.github.io/<repo>/` rather than `https://<user>.github.io/<repo>/index.html`.

## Known limits

- Programs that use `*question: captcha` do not work in the harness, because the harness has no reCAPTCHA site key to give GuidedTrack.
- Screenshots are made by redrawing the page's DOM, not by copying the screen. Fixed-position elements other than the harness's own controls may land where they sit in the document rather than where they appeared on screen.
- The reviewer's name is stored in the browser, not in the link, so it does not carry over to another browser or device.
- "Reset everything" returns to the harness only when the harness was opened at the exact address saved on the Publish page (`/<repo>/`, not `/<repo>/index.html`).

## Development

Requirements: Node 24. Browser tests need Playwright 1.49.0 and its Chromium. The dev container has both preinstalled; elsewhere run `npm install --no-save playwright@1.49.0 && npx playwright install chromium` once.

- `npm install`
- `npm run build` or `npm run watch`
- `npm test` builds, then runs the unit tests, then the browser tests
- `npm run format`

Backend: Supabase. `src/config.js` holds the project URL and anon key (public). `npm run test:db` runs the database policy tests against `SUPABASE_DB_URL` (the project's session-pooler connection string); CI runs them against a throwaway local database.

Serve the repository root with any static server (for example `npx serve .`) and open `index.html` through it. Opening the file directly from disk does not work because the page uses module scripts.

## Deployment

Every push to `main` runs the tests, builds, and publishes to GitHub Pages through `.github/workflows/deploy.yml`. In the repository settings, set Pages to deploy from **GitHub Actions** once.

## Design

The design spec is `docs/superpowers/specs/2026-10-14-gt-feedback-harness-design.md`. Implementation plans live under `docs/superpowers/plans/`, and spike findings under `docs/superpowers/spikes/`.
