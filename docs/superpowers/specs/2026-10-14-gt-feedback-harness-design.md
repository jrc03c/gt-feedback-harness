# GuidedTrack Feedback Harness: Design

Date: 2026-10-14

## Purpose

Spark Wave builds, reviews, and deploys GuidedTrack (GT) programs continually. Today a colleague reviewing a program takes screenshots, pastes them into an email, and writes commentary around them. This project replaces that with a harness: a page that embeds a GT program, lets the reviewer annotate a screenshot of any moment and type feedback, records the whole run, and gives the developer an inbox where each piece of feedback arrives with an annotated image, the typed text, the source lines that produced the page, the run's variables, and a replayable recording.

It is a feedback harness, not a testing harness. The auto-runner on the `main` branch (`gt-tester`) is a separate tool and stays separate.

## Decisions already made

- **Backend: Supabase free tier** (Postgres, Storage, Auth). Chosen for zero cost with no card on file. Firebase was rejected because its card-free plan excludes Storage and Functions, and its paid plan has no hard spending cap.
- **Front-end hosting: GitHub Pages**, from a public repo, deployed by GitHub Actions. Vercel was rejected because its free tier is limited to non-commercial use and would be another account.
- **Front-end stack: vanilla JavaScript modules bundled with esbuild.** No framework. Dependencies: the Supabase JS client, rrweb and rrweb-player, and a DOM-to-image library (modern-screenshot to start).
- **Data path: clients write directly to Supabase under row-level security.** No server code of our own. Reviewers are signed in anonymously; developers use GitHub sign-in (Google can be added later).
- **Access model.** Developers must sign in to register programs and to view feedback. Reviewers never sign in. A registered program gets a long random share id and two links, one per GT mode (`run` and `test`). Feedback is stored under the registering developer. The harness does not try to mirror GT's own access control.
- **Routing uses query strings, not paths or hashes.** See "Why query-string routing" below.
- **Recording is on by default**, with a visible indicator and an off switch. If storage limits bite, switch to opt-in.
- **Screenshots cover the visible viewport only**, excluding the harness's own controls.
- **Inbox v1** includes: list sessions, view items, delete a session, mark an item resolved, download the flattened annotated image as PNG, and replay the recording with markers at each feedback moment.
- Phase 1 shipped a single HTML report download in place of the backend; Phase 2 replaced it with Supabase storage (this plan).

## Facts about GuidedTrack that the design relies on

All verified by reading `temp/guidedtrack-web`.

- **The embed renders in-page DOM, not an iframe.** `gt_interpreter.js` renders into `.program_container .main` inside the host document and fires jQuery events on `window`. DOM-to-image capture, DOM recording, and reading run state therefore work without cross-origin tricks.
- **Container markup.** The host page must provide the same markup as `app/views/programs/_program_container.html.erb`: a `.guidedtrack.program_container` div whose `id` is the program key, containing `#program_navigation` (with `#back-button`, `.navigation_container`, `#run-menu`, `.points`), `.maintain`, and `.main`. `data-mode="test"` selects test mode; omitting the attribute gives the normal run mode.
- **Lifecycle events** on `window` (jQuery): `guidedtrack:pageStart`, `guidedtrack:append`, `guidedtrack:pageEnd`, `guidedtrack:done`.
- **Source line tracing.** Each node broadcasts `guidedtrack:trace` with `detail: {from, to, program}` as it renders (`app/assets/javascripts/interpreter/nodes/node.js.coffee`, `_broadcast_line_numbers`), but only when the compiled node carries `line_number`. The compiler serializes `line_number` when present (`compiler/lib/guided_track/node.rb:163`). Whether the public embed build includes it is unverified and is the subject of the first spike.
- **Run state.** `window.data` exposes `get('run_id')`, `get('current_program_name')`, `node()`, `get_variable(name)`, and the heap. The exact heap accessor is confirmed during implementation.
- **Embed authorization.** The embed endpoint checks the `Referer` header against the program's saved pages (`app/helpers/embed_program_helper.rb`). The allow list for each saved page contains both its full path and its bare origin (`app/models/program.rb`, `referrers_allowed_for`). Modern browsers send only the origin on cross-origin requests, so the harness origin matches once it is saved.
- **Reset everything.** GT's run menu links to `/programs/:key/rerun?_redirect=<current URL without fragment>` (`run_menu.js.coffee`, `_redirect_param`). The server redirects back only if the redirect URL's scheme, host, and path exactly match a saved page (`programs_controller.rb`, `rerun`); otherwise it returns a bare 400. The query string is ignored in the comparison but preserved in the redirect.
- **Embed refusal message.** When the embed is refused, GT renders the text "This page is not set up to run this program." into the container (`loading_message.js.coffee`).

### Why query-string routing

Hash routing would break "Reset everything": the client strips the fragment before building `_redirect`, so the reviewer would land on the harness root with no program selected. Path routing would require the developer to save every link's exact path in GT. Query-string routing avoids both: the developer saves the harness origin once, and reset round-trips through GT with the query intact.

## Architecture

### Deployment shape

One public GitHub repository. The front-end is static files built by esbuild and published to GitHub Pages by a GitHub Actions workflow on every push to `main`. Supabase holds Postgres, Storage, and Auth. Schema and policies live in the repo as SQL migrations applied with the Supabase CLI. A weekly scheduled job pings the database (preventing Supabase's idle pause) and deletes recording chunks older than the retention window.

### Screens

A single `index.html` reads the query string and mounts one of three screens:

- **Reviewer** (`?r=SHARE_ID&mode=run` or `mode=test`): the GT embed plus the harness's floating controls. Signs in anonymously behind the scenes.
- **Developer** (`?dev`, or no parameters): Google sign-in, program list, registration form that shows the two links and the setup instruction, link regeneration, and the inbox per program.
- **Session** (`?session=ID`, developer only): feedback items with annotated screenshots and the replay player.

Links look like `https://<user>.github.io/<repo>/?r=SHARE_ID&mode=run`. The developer must add `https://<user>.github.io/<repo>/` to the program's Publish page. The harness must not set a referrer policy that sends full URLs.

### Front-end modules

Each has one purpose and can be tested on its own.

- `router`: parses the query string and mounts a screen.
- `gt-embed`: injects the container markup and GT's stylesheet and script tags, sets the program key and `data-mode`, relays `pageStart`, `pageEnd`, and `trace` events, and detects a refused embed.
- `context`: assembles the per-page line ranges, program names, run id, node id, variable snapshot, viewport, user agent, and timestamp on demand.
- `recorder`: wraps rrweb, batches events into gzipped chunks, uploads them on a timer and on page hide, and inserts a custom marker when feedback is sent.
- `capture`: returns the viewport as an image plus its size, excluding harness chrome.
- `annotations`: the shared renderer from annotation JSON to SVG, with a live mode (editable callouts) and a static mode (flattenable).
- `annotator`: the editor on top of the renderer: tools, selection, move, resize, delete, undo. No Supabase knowledge.
- `feedback-modal`: composes capture, annotator, the textarea, and the send button.
- `store`: the only module that talks to Supabase: auth, share resolution, sessions, items, uploads, program registration, inbox queries.
- `inbox` and `replay`: the developer screens and the rrweb player.

### Data flow for one feedback item

Click the feedback button, hide harness chrome, capture the viewport, open the modal with the image, annotate and type, click Send. The modal uploads the screenshot, inserts the item row with annotation JSON and context, adds a marker to the recording, shows a "Sent" toast, and closes. Each item is independent, so a tab closed later loses nothing already sent.

## Data model

### Tables

All tables have row-level security enabled.

- `programs`: `id`, `owner_id` (developer's auth uid), `gt_key`, `label` (optional), `share_id`, `created_at`. `share_id` is a 24-character random string generated in the browser from `crypto.getRandomValues`, unique across the table. `(owner_id, gt_key)` is unique, so two developers can register the same program independently.
- `sessions`: `id`, `program_id`, `reviewer_uid` (anonymous auth uid), `reviewer_name`, `mode` (`run` or `test`), `gt_run_id`, `user_agent`, `viewport`, `recording_enabled`, `recording_gap` (true if events were dropped), `started_at`, `last_seen_at`.
- `items`: `id`, `session_id`, `created_at`, `text`, `annotations` (JSON), `context` (JSON), `screenshot_path`, `image_size`, `recording_offset_ms`, `resolved_at`.

Deleting a session cascades to its items.

### Storage

Two private buckets:

- `screenshots`: `{session_id}/{item_id}.webp`
- `recordings`: `{session_id}/{sequence}.json.gz`

Recording chunks are discovered by listing the session's folder.

### Share resolution

A SQL function `resolve_share(share_id)` marked `security definer` returns only the program id and GT key for one share id. Reviewers call it over RPC. They cannot list programs.

### Policies

- Programs: the owner can select, insert, update, and delete their own rows. Nobody else can see them.
- Sessions: an authenticated user may insert a session only with their own uid and only when the share id supplied in the insert matches the program. The reviewer can read and update their own session. The program owner can read and delete it.
- Items: the session's reviewer can insert and read. The owner can read, delete, and update `resolved_at`.
- Storage: a user can upload into a session folder only if that session's `reviewer_uid` is theirs. The owner and the reviewer can read.

### Auth settings

Anonymous sign-in enabled. Google provider enabled with the GitHub Pages URL as the redirect. Anonymous users accumulate in the auth table, which is harmless.

### Retention

Deleting a session removes its rows and both storage folders. The weekly job deletes recording chunks older than 60 days using the service role key stored as a repository secret. That is the only place a privileged key is used, and it never reaches the browser.

## Reviewer screen

### Embedding

Read `r` and `mode`, sign in anonymously, call `resolve_share`, inject the container markup with the GT key as `id` and `data-mode="test"` for test links (no attribute for run links), then append GT's stylesheet and its three script tags (`jquery_gt.js`, `bootstrap.min.js`, `gt_interpreter.js`). Scripts are appended only after the container exists.

### Failure detection

A mutation observer watches the container for the refusal message and replaces it with a harness banner showing the exact origin URL to paste into the program's Publish page and a reload button. The same banner handles an unknown share id.

### Context capture

On `pageStart` the per-page list clears; each `trace` event appends its `{from, to, program}`; `pageEnd` freezes it. An item's context is: line ranges with sub-program names, GT run id, current node id, a variable snapshot from `window.data` capped at 100 KB (truncated with a flag if larger), viewport size, user agent, and timestamp. If the public build lacks line numbers, the lines field is empty and the rest still works.

### Session lifecycle

The session row is created on load and its id kept in `sessionStorage`, so a reload in run mode continues the same session, matching how GT continues the same run. A `last_seen_at` heartbeat runs every minute.

### Recording

rrweb starts after the session row exists, with a full snapshot and periodic checkouts so the player can seek. Mouse-move sampling is throttled. Events buffer in memory and flush every five seconds or 500 KB, whichever comes first: the buffer is gzipped with the native `CompressionStream` and uploaded as the next numbered chunk. On tab hide the remaining buffer is sent with a keep-alive fetch, so at most a few seconds are lost. Sending feedback inserts an rrweb custom event and stores the offset in the item row. The indicator is a red dot labelled "Recording"; clicking it stops recording and updates the session row, and clicking again restarts with a fresh snapshot.

### Floating controls

A fixed cluster in the bottom-right corner: the "Give feedback" button, the recording toggle, and on first visit an optional name field remembered in `localStorage` and written to the session. Everything in the cluster carries a marker attribute so capture excludes it. On phones the cluster shrinks to icons.

### Reset everything

Left to GT's own menu. With query-string routing the redirect lands back on the same link.

## Capture and the annotation modal

### Capture

Render the document to a canvas with modern-screenshot, cropped to the current scroll position and viewport, at the device pixel ratio capped at 2. Elements carrying the harness marker attribute are filtered out. Images served without CORS headers render blank rather than failing. Encode as WebP at about 85% quality. The module's interface is one function returning an image and its size, so the library can be swapped.

### Modal layout

A full-screen overlay with a toolbar on top, the image scaled to fit in the middle, and the textarea with Cancel and Send at the bottom. On phones the toolbar becomes icons and the textarea collapses to one row until focused.

### Editor model

The SVG overlay's `viewBox` equals the image's pixel size, so annotations are stored in image coordinates. The document is a list of shapes, each with an id and a type:

- `pen`: point list, fixed width, opaque red, round caps and joins.
- `highlight`: point list, thick stroke, yellow at 40% opacity with multiply blending.
- `callout`: anchor point, box rectangle, text.

Paths are thinned on commit.

### Tools

All interaction goes through pointer events with `touch-action: none` on the overlay.

- **Select**: click to select, drag to move, Delete or Backspace or the trash button removes. Moving a path translates its points on release.
- **Pen** and **Highlighter**: press, drag, release.
- **Callout**: a hint reads "Click where the note should point." The click sets the anchor; the box appears offset up and to the right, clamped inside the image, with its text focused. The anchor dot drags independently, the box drags by its edge, a corner handle resizes it, and clicking inside edits the text. The connector runs from the anchor to the nearest point on the box edge with an arrowhead at the anchor.
- **Undo**: a snapshot stack behind a toolbar button and Ctrl+Z.

### Shared rendering

One module turns annotation JSON into SVG. The editor uses live mode with callout text in a `foreignObject`. The inbox uses static mode with callout text as wrapped SVG `text` elements, because Safari cannot rasterize `foreignObject` to a canvas. Static mode produces the downloadable flattened PNG.

### Sending

Send is always enabled. On click: upload the WebP, insert the item row, add the recording marker, show a toast, close. On failure the modal stays open with the error and a retry button.

## Developer screens

### Sign-in and programs

Google sign-in through Supabase, returning to the Pages URL. The home screen lists programs with label, GT key, session count, unresolved item count, and last activity. The register form takes a GT key and optional label. After saving, a panel shows the run link, the test link, copy buttons, and the setup instruction with the exact origin URL. "Regenerate links" asks for confirmation and replaces the share id.

### Inbox

Per program, sessions newest first: reviewer name, mode, start time, approximate duration, item count with unresolved count, whether a recording exists, and a delete button with confirmation. A filter hides sessions with no unresolved items.

### Session view

A header with session metadata, then items in time order. Each card shows the annotated screenshot (static renderer) with a Download PNG button, the typed text, a collapsed context panel (sub-programs with line ranges, variable table, viewport, user agent, timestamp), Resolve and Unresolve, and "Show in replay".

### Replay

The player loads only when expanded. It fetches the session's chunks in sequence, decompresses them with `DecompressionStream`, concatenates the events, and hands them to rrweb-player. A marker strip above the player's controls shows one tick per item at its offset; clicking seeks. GT's stylesheet and images load from guidedtrack.com during replay.

Line numbers are shown as text ("program `main`, lines 42 to 47"). GT's editor has no line-anchor URL and the harness never learns the numeric editor id.

## Failure handling

- Backend unreachable: the reviewer page shows a banner saying the harness backend is unavailable and to tell the developer. The GT program cannot run, because the harness needs the backend to resolve the share link into a program key, so the banner is shown instead.
- Chunk upload fails: retried with backoff. The buffer is capped at 5 MB; on overflow the oldest events are dropped and `recording_gap` is set.
- Session deleted mid-run: writes fail, the feedback button shows an error, nothing crashes.
- Capture throws: the modal opens with a gray placeholder and a note so the reviewer can still type.

## Security

The anon key is public by design; every protection is a policy. Share ids have about 140 bits of entropy and can be regenerated. All reviewer-supplied strings render as text, never HTML. rrweb replays inside a sandboxed iframe with scripts stripped. The variable snapshot is visible only to the owner. No rate limiting in v1 beyond Supabase's own; it is the first thing to add if abuse appears.

## Testing

- **Unit tests** in Node for pure modules: routing, annotation operations (translation, path thinning, nearest-edge connector math), gzip chunk round-trips, context assembly from synthetic events.
- **Browser tests** with Playwright: the annotation editor against a fixture image (draw, create callout, move, resize, delete, undo); the reviewer page against a stub that mimics GT's container and fires its jQuery events (embed failure detection, context capture, recording markers). One optional smoke test runs the real public demo program (`odwuk6y`) when the network allows.
- **Policy tests** with pgTAP against a local Supabase stack in GitHub Actions: a reviewer cannot read another reviewer's session, an owner cannot see another owner's programs, and so on.

## Deployment

One workflow: on push to `main`, build with esbuild, publish to Pages, and apply new migrations with the Supabase CLI using an access token secret. A scheduled weekly job pings the database and deletes recording chunks past the retention window. The Supabase URL and anon key are committed in a config file.

## Spikes before implementation

Each about an hour, both using the public demo program:

1. Confirm that `guidedtrack:trace` carries line numbers in the public embed build. Fallback: context without lines.
2. Confirm that modern-screenshot renders a typical GT page acceptably. Fallback: html2canvas behind the same interface.

## Out of scope for v1

- Sharing an inbox with other developers by email (fits later as a collaborators list on `programs`).
- Email or Slack notification when a session finishes (would need an edge function and a mail provider).
- Full-page screenshots.
- Rate limiting and abuse controls beyond Supabase defaults.
- Combining the harness with the auto-runner on `main`.
