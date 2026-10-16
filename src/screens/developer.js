import { OAUTH_PROVIDER } from "../config.js"
import { harnessPageUrl, renderErrorBanner } from "./banners.js"
import { programLabel } from "../format.js"

export function shareLinks(pageUrl, shareId) {
  const base = `${pageUrl}?r=${encodeURIComponent(shareId)}&mode=`
  return { run: `${base}run`, test: `${base}test` }
}

function isDeveloper(user) {
  return Boolean(user) && user.is_anonymous !== true
}

// Shared gate for the developer, inbox, and session screens. Screens
// re-mount themselves after changes, so the auth listener is bound once per
// root and always calls the most recent render.
const gates = new WeakMap()

export async function withDeveloper(options) {
  const { root, store } = options
  gates.set(root, options)
  if (!root.dataset.harnessAuthBound) {
    root.dataset.harnessAuthBound = "true"
    store.onAuthChange(() => {
      show(gates.get(root)).catch(error =>
        renderErrorBanner(root, error.message),
      )
    })
  }
  await show(options)
}

async function show({
  root,
  store,
  render,
  provider = OAUTH_PROVIDER,
  pageUrl = harnessPageUrl(),
}) {
  const user = await store.getUser()
  if (!isDeveloper(user)) {
    renderSignIn(root, () =>
      store.signInWithProvider(provider, `${pageUrl}?dev`),
    )
    return
  }
  await render(user)
}

function renderSignIn(root, onSignIn) {
  root.innerHTML = `
    <main class="harness-home harness-signin">
      <h1>GuidedTrack Feedback Harness</h1>
      <p>Developers sign in to register programs and read feedback. Reviewers never sign in; they just open the links you give them.</p>
      <button type="button">Sign in with Google</button>
    </main>`
  root.querySelector("button").addEventListener("click", () => {
    onSignIn().catch(error => renderErrorBanner(root, error.message))
  })
}

export async function mountDeveloper({
  root,
  store,
  provider = OAUTH_PROVIDER,
  pageUrl = harnessPageUrl(),
  confirm = message => window.confirm(message),
}) {
  await withDeveloper({
    root,
    store,
    provider,
    pageUrl,
    render: async user => {
      const programs = await store.listPrograms()
      root.innerHTML = `
        <main class="harness-home harness-developer">
          <header class="harness-dev-header">
            <h1>Your programs</h1>
            <span class="harness-user"></span>
            <button type="button" data-action="signout">Sign out</button>
          </header>
          <p>Before a link works, add this URL to the program's <strong>Publish</strong> page on GuidedTrack, under the pages allowed to run it:</p>
          <pre class="harness-setup-url"></pre>
          <form class="harness-register">
            <label>GuidedTrack key <input name="key" required pattern="[A-Za-z0-9]+" placeholder="abc1234" autocomplete="off" /></label>
            <label>Label (optional) <input name="label" placeholder="Sleep study v2" /></label>
            <button type="submit">Register program</button>
            <p class="harness-error" hidden></p>
          </form>
          <section class="harness-programs"></section>
        </main>`
      root.querySelector(".harness-user").textContent = user.email || ""
      root.querySelector(".harness-setup-url").textContent = pageUrl
      root
        .querySelector('[data-action="signout"]')
        .addEventListener("click", () => store.signOut())

      const form = root.querySelector(".harness-register")
      form.addEventListener("submit", async event => {
        event.preventDefault()
        const data = new FormData(form)
        const error = form.querySelector(".harness-error")
        try {
          await store.registerProgram({
            gtKey: String(data.get("key")),
            label: String(data.get("label") || ""),
          })
          await mountDeveloper({ root, store, provider, pageUrl, confirm })
        } catch (failure) {
          error.textContent = failure.message
          error.hidden = false
        }
      })

      const list = root.querySelector(".harness-programs")
      for (const program of programs) list.appendChild(programCard(program))
      if (programs.length === 0) {
        const empty = document.createElement("p")
        empty.textContent =
          "No programs yet. Register one above to get its feedback links."
        list.appendChild(empty)
      }

      function programCard(program) {
        const card = document.createElement("article")
        card.className = "harness-program-card"
        const links = shareLinks(pageUrl, program.share_id)
        card.innerHTML = `
          <h3></h3>
          <p class="harness-counts"></p>
          <label class="harness-link"><span>Run link</span><input type="text" readonly /><button type="button" data-copy="run">Copy</button></label>
          <label class="harness-link"><span>Test link</span><input type="text" readonly /><button type="button" data-copy="test">Copy</button></label>
          <p class="harness-card-actions">
            <a></a>
            <button type="button" data-action="regenerate">Regenerate links</button>
            <button type="button" data-action="delete">Delete program</button>
          </p>`
        card.querySelector("h3").textContent =
          `${programLabel(program)} (${program.gt_key})`
        card.querySelector(".harness-counts").textContent =
          `${program.session_count} session${program.session_count === 1 ? "" : "s"}, ${program.unresolved_count} unresolved item${program.unresolved_count === 1 ? "" : "s"}`
        const inputs = card.querySelectorAll(".harness-link input")
        inputs[0].value = links.run
        inputs[1].value = links.test
        for (const button of card.querySelectorAll("[data-copy]")) {
          button.addEventListener("click", async () => {
            const value = button.dataset.copy === "run" ? links.run : links.test
            try {
              await navigator.clipboard.writeText(value)
              button.textContent = "Copied"
              setTimeout(() => (button.textContent = "Copy"), 1500)
            } catch {
              inputs[button.dataset.copy === "run" ? 0 : 1].select()
            }
          })
        }
        const inbox = card.querySelector("a")
        inbox.href = `?dev&program=${encodeURIComponent(program.id)}`
        inbox.textContent = "Open inbox"
        card
          .querySelector('[data-action="regenerate"]')
          .addEventListener("click", async () => {
            if (
              !confirm(
                "Regenerate the links? The old links stop working immediately. Stored feedback is kept.",
              )
            )
              return
            await store.regenerateShare(program.id)
            await mountDeveloper({ root, store, provider, pageUrl, confirm })
          })
        card
          .querySelector('[data-action="delete"]')
          .addEventListener("click", async () => {
            if (
              !confirm(
                `Delete "${programLabel(program)}" and all its feedback? This cannot be undone.`,
              )
            )
              return
            await store.deleteProgram(program.id)
            await mountDeveloper({ root, store, provider, pageUrl, confirm })
          })
        return card
      }
    },
  })
}
