# GuidedTrack Feedback Harness

Embed a GuidedTrack program, screenshot it, draw on the screenshot, type feedback, and send it to the developer, who reads it in an inbox. This version (Phase 2) stores feedback in Supabase. A later phase adds session recording and replay.

## Using it

### For developers

1. Open the harness URL and sign in with GitHub.

2. Register the program's key. The harness gives the program a run link and a test link.

3. On GuidedTrack, open the program's **Publish** page and add the harness URL to the list of pages allowed to run the program. The harness URL is the page's own address, for example `https://<user>.github.io/<repo>/`. Adding it once covers every link.

4. Copy the run link or the test link and send it to reviewers.

Feedback appears in your inbox. Each item shows the annotated screenshot, the typed text, the source lines that were on screen, and the run's variables. You can mark items resolved, download the annotated PNG, and delete sessions.

### For reviewers

Open the link, run the program, click **Give feedback** at any point, draw with the pen or highlighter, add notes that point at parts of the page, type in the box, and click **Send feedback**. There is nothing to install and no account to create.

"Reset everything" in GuidedTrack's menu works because the link keeps the share id and mode in the query string (the reviewer's name is remembered separately, in the browser). It only brings you back to the harness when you opened the harness at the address you saved on the Publish page, for example `https://<user>.github.io/<repo>/` rather than `https://<user>.github.io/<repo>/index.html`.

## Known limits

- Programs that use `*question: captcha` do not work in the harness, because the harness has no reCAPTCHA site key to give GuidedTrack.
- Screenshots are made by redrawing the page's DOM, not by copying the screen. Fixed-position elements other than the harness's own controls may land where they sit in the document rather than where they appeared on screen.
- The reviewer's name is stored in the browser, not in the link, so it does not carry over to another browser or device.
- "Reset everything" returns to the harness only when the harness was opened at the exact address saved on the Publish page (`/<repo>/`, not `/<repo>/index.html`).
- Free-tier Supabase pauses a project after a week without traffic. The weekly CI ping prevents it.
- Anonymous sign-ins are limited to 30 per hour per IP address.
- Regenerating a program's links stops new sessions from starting with the old links, but sessions that are already open keep working. To cut off a leaked link completely, regenerate the links and delete the sessions it started.
- GitHub disables the weekly keep-alive schedule after 60 days without repository activity. If that happens, re-enable the workflow under the repository's **Actions** tab.

## Development

Requirements: Node 24. Browser tests need Playwright 1.49.0 and its Chromium. The dev container has both preinstalled; elsewhere run `npm install --no-save playwright@1.49.0 && npx playwright install chromium` once.

- `npm install`
- `npm run build` or `npm run watch`
- `npm test` builds, then runs the unit tests, then the browser tests
- `npm run format`

Backend: Supabase. `src/config.js` holds the project URL and publishable key (public). `npm run test:db` runs the database policy tests against the project (see "Setting up the backend"); CI runs them against a throwaway local database.

Serve the repository root with any static server (for example `npx serve .`) and open `index.html` through it. Opening the file directly from disk does not work because the page uses module scripts.

## Setting up the backend

The project's settings live in the Supabase dashboard, not in this repository. `supabase/config.toml` only configures a local stack.

- **Project options** (when creating the project): do not automatically expose new tables to the Data API, and enable automatic row-level security.
- **Authentication, Sign In / Providers**: enable Anonymous sign-ins, and enable the GitHub provider with the callback URL `https://<ref>.supabase.co/auth/v1/callback` (where `<ref>` is the project ref) set on the GitHub OAuth app.
- **Authentication, URL Configuration**: set the Site URL to `https://jrc03c.github.io/gt-feedback-harness/` and add `https://jrc03c.github.io/gt-feedback-harness/**` to the redirect allow list.

The deploy workflow needs three repository secrets:

- `SUPABASE_ACCESS_TOKEN`: a Supabase access token scoped to Project Settings, API Keys, and API Key Secrets (read).
- `SUPABASE_PROJECT_REF`: the project ref.
- `SUPABASE_DB_PASSWORD`: the database password.

Local database tools read a `.env` file at the repository root (it is git-ignored; never commit it):

```
SUPABASE_DB_URL_TEMPLATE=<the session-pooler connection string, with the literal [YOUR-PASSWORD] placeholder left in>
SUPABASE_DB_PASSWORD=<the database password>
```

`scripts/db-url.mjs` substitutes the encoded password into the template (a `SUPABASE_DB_URL` environment variable overrides both). `npm run test:db` uses it to run the policy tests, and migrations are pushed with:

```
npx supabase db push --db-url "$(node -e 'import("./scripts/db-url.mjs").then(m => console.log(m.databaseUrl()))')"
```

## Deployment

Every push to `main` runs the tests, builds, and publishes to GitHub Pages through `.github/workflows/deploy.yml`. In the repository settings, set Pages to deploy from **GitHub Actions** once.

## Design

The design spec is `docs/superpowers/specs/2026-10-14-gt-feedback-harness-design.md`. Implementation plans live under `docs/superpowers/plans/`, and spike findings under `docs/superpowers/spikes/`.
