# GuidedTrack Feedback Harness

Embed a GuidedTrack program, screenshot it, draw on the screenshot, type feedback, and send it to the developer, who reads it in an inbox. This version (Phase 2) stores feedback in Supabase. A later phase adds session recording and replay.

## Using it

### For developers

1. Open the harness URL and sign in with GitHub.

2. Register the program's key, with an optional name. The harness gives the program a run link and a test link. You can rename the program later from its card.

3. On GuidedTrack, open the program's **Publish** page and add the harness URL to the list of pages allowed to run the program. The harness URL is the page's own address, for example `https://<user>.github.io/<repo>/`. Adding it once covers every link.

4. Copy the run link or the test link and send it to reviewers.

Your GitHub username and a Sign out button sit at the top of every developer page. The username links to your account page, where you can delete your account; that removes every program you registered with all its feedback and screenshots, and signing in again afterwards starts a fresh account.

Feedback appears in your inbox. Sessions with unresolved items are flagged, and the table sorts by any column when you click its header. Each item shows the annotated screenshot, the typed text, the source lines that were on screen, and the run's variables. Click a screenshot to see it full size or open it in a new tab. You can mark items resolved (they turn gray), download the annotated PNG, and delete sessions.

### For reviewers

Open the link, run the program, click **Give feedback** at any point, draw with the pen or highlighter, add notes that point at parts of the page, type in the box, and click **Send feedback**. There is nothing to install and no account to create.

"Reset everything" in GuidedTrack's menu works because the link keeps the share id and mode in the query string (the reviewer's name is remembered separately, in the browser). It only brings you back to the harness when you opened the harness at the address you saved on the Publish page, for example `https://<user>.github.io/<repo>/` rather than `https://<user>.github.io/<repo>/index.html`.

### For scripts and agents

Everything the developer pages do is also available from the command line, so a script or a coding agent can register programs, hand out feedback links, and read feedback back. The CLI prints JSON on stdout and a JSON error on stderr with exit code 1.

1. On the harness's account page, click **Generate script password**. It shows two `.env` lines. Put them in a `.env` file in the project where the scripts run (or export them). The password gives the same access as your GitHub sign-in, and generating a new one revokes the old one.

2. For `setup`, also provide your GuidedTrack login as `GT_EMAIL` and `GT_PASSWORD`, so the CLI can find programs by name and add the harness URL to their Publish page for you.

3. Install the CLI in that project from GitHub. It is pinned to a commit by the lock file; update it with `npm update gt-feedback-harness`.

```
npm install --save-dev github:jrc03c/gt-feedback-harness
```

Then, from that project:

```
npx gt-feedback-harness setup "My Program"        # by name, or by key
npx gt-feedback-harness programs
npx gt-feedback-harness sessions <key or id>
npx gt-feedback-harness feedback <key or id> --out feedback   # add --all for resolved items too
npx gt-feedback-harness resolve <item id>         # or unresolve
npx gt-feedback-harness --help
```

`setup` is safe to repeat: it adds the harness URL to the program's Publish page only if it is missing, registers the program only if it is new, and always prints the run and test links. Without GuidedTrack credentials it accepts a key only and skips the Publish page step.

`feedback` writes each item's screenshot to the output directory as the raw `.webp`, the annotations as an `.svg` overlay, and, when ImageMagick (`magick` or `convert`) is installed, the flattened `.png`. The JSON includes each item's text, annotations, the source lines and variables captured with it, and the GuidedTrack run id.

A typical agent loop: push the program to GuidedTrack, run `setup`, give the links to a reviewer, then run `feedback` and `resolve` as items are handled.

## Known limits

- Programs that use `*question: captcha` do not work in the harness, because the harness has no reCAPTCHA site key to give GuidedTrack.
- Screenshots are made by redrawing the page's DOM, not by copying the screen. Fixed-position elements other than the harness's own controls may land where they sit in the document rather than where they appeared on screen. Audio players, embedded videos, other embedded frames, and images whose server does not allow cross-origin reads appear as gray boxes of the same size (see `docs/backlog.md` for the planned fix).
- GuidedTrack serves its stylesheets without cross-origin headers, so the screenshot library cannot read their icon font declarations. The deploy workflow therefore copies those declarations, with the font files inlined, into `gt-fonts.css` next to the site, on every deploy and once a week; the capture hands that file to the screenshot library. Icons GuidedTrack adds between refreshes are missing from screenshots until the next deploy, and without the file (for example when serving the repository locally) screenshots lack the icons (the back arrow, the menu, the points star) altogether. `npm run fonts` writes the file at the repository root (it is git-ignored).
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

Backend: Supabase. `src/config.js` holds the project URL, publishable key (public), and the published harness URL.

Two live tests skip unless credentials are in the environment: `GT_EMAIL` and `GT_PASSWORD` for the GuidedTrack client, and `GT_FEEDBACK_HARNESS_EMAIL` and `GT_FEEDBACK_HARNESS_PASSWORD` for password sign-in to the real project. `npm run test:db` runs the database policy tests against the project (see "Setting up the backend"); CI runs them against a throwaway local database.

Serve the repository root with any static server (for example `npx serve .`) and open `index.html` through it. Opening the file directly from disk does not work because the page uses module scripts.

## Setting up the backend

The project's settings live in the Supabase dashboard, not in this repository. `supabase/config.toml` only configures a local stack.

- **Project options** (when creating the project): do not automatically expose new tables to the Data API, and enable automatic row-level security.
- **Authentication, Sign In / Providers**: enable Anonymous sign-ins, enable the Email provider (script passwords sign in with it), and enable the GitHub provider with the callback URL `https://<ref>.supabase.co/auth/v1/callback` (where `<ref>` is the project ref) set on the GitHub OAuth app.
- **Authentication, URL Configuration**: set the Site URL to `https://jrc03c.github.io/gt-feedback-harness/` and add `https://jrc03c.github.io/gt-feedback-harness/**` to the redirect allow list.

The deploy workflow needs two repository secrets, the same values as the local `.env` file described below:

- `SUPABASE_DB_URL_TEMPLATE`: the session-pooler connection string with the literal `[YOUR-PASSWORD]` placeholder.
- `SUPABASE_DB_PASSWORD`: the database password.

The workflow pushes migrations through the pooler rather than `supabase link`, because the direct database host is IPv6-only and GitHub's runners have no IPv6.

Local database tools read a `.env` file at the repository root (it is git-ignored; never commit it):

```
SUPABASE_DB_URL_TEMPLATE=<the session-pooler connection string, with the literal [YOUR-PASSWORD] placeholder left in>
SUPABASE_DB_PASSWORD=<the database password>
```

`scripts/db-url.mjs` substitutes the encoded password into the template; both values can also be set as environment variables, and a `SUPABASE_DB_URL` environment variable overrides everything. `npm run test:db` uses it to run the policy tests, and migrations are pushed with:

```
npx supabase db push --db-url "$(node -e 'import("./scripts/db-url.mjs").then(m => console.log(m.databaseUrl()))')"
```

## Deployment

Every push to `main` runs the tests, builds, and publishes to GitHub Pages through `.github/workflows/deploy.yml`; the weekly scheduled run does the same, which also refreshes `gt-fonts.css`. In the repository settings, set Pages to deploy from **GitHub Actions** once.

## Design

Deferred ideas are in `docs/backlog.md`. The design spec is `docs/superpowers/specs/2026-10-14-gt-feedback-harness-design.md`. Implementation plans live under `docs/superpowers/plans/`, and spike findings under `docs/superpowers/spikes/`.
