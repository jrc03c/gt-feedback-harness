import { OAUTH_PROVIDER } from "../config.js"
import { harnessPageUrl, renderErrorBanner } from "./banners.js"
import { programLabel, userLabel } from "../format.js"
import { renderProgramHeading } from "./heading.js"

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
  const previous = gates.get(root)
  const entry = {
    options,
    renderedId: previous ? previous.renderedId : undefined,
  }
  gates.set(root, entry)
  if (!root.dataset.harnessAuthBound) {
    root.dataset.harnessAuthBound = "true"
    store.onAuthChange(async () => {
      try {
        const current = gates.get(root)
        const user = await store.getUser()
        const id = isDeveloper(user) ? user.id : null
        if (id === current.renderedId) return
        await show(current.options, current)
      } catch (error) {
        renderErrorBanner(root, error.message)
      }
    })
  }
  await show(options, entry)
}

async function show(
  {
    root,
    store,
    render,
    provider = OAUTH_PROVIDER,
    pageUrl = harnessPageUrl(),
  },
  entry,
) {
  const user = await store.getUser()
  entry.renderedId = isDeveloper(user) ? user.id : null
  if (!isDeveloper(user)) {
    renderSignIn(root, provider, () =>
      store.signInWithProvider(provider, `${pageUrl}?dev`),
    )
    return
  }
  await render(user)
  renderTopbar(root, store, user)
}

// The bar every developer page starts with: who is signed in (linking to the
// account page) and Sign out. Added after the page renders, as the first
// child of its <main>.
function renderTopbar(root, store, user) {
  const main = root.querySelector("main")
  if (!main || main.querySelector(".harness-topbar")) return
  const bar = document.createElement("header")
  bar.className = "harness-topbar"
  bar.innerHTML = `<a class="harness-user" href="?account"></a><button type="button" data-action="signout">Sign out</button>`
  bar.querySelector(".harness-user").textContent = userLabel(user)
  bar
    .querySelector('[data-action="signout"]')
    .addEventListener("click", async () => {
      try {
        await store.signOut()
      } catch (failure) {
        renderErrorBanner(root, `Could not sign out: ${failure.message}`)
      }
    })
  main.prepend(bar)
}

// signInWithProvider stays generic; add a label here to offer another provider.
const PROVIDER_LABELS = { github: "GitHub", google: "Google" }

function renderSignIn(root, provider, onSignIn) {
  root.innerHTML = `
    <main class="harness-home harness-signin">
      <h1>GuidedTrack Feedback Harness</h1>
      <p>Developers sign in to register programs and read feedback. Reviewers never sign in; they just open the links you give them.</p>
      <button type="button"></button>
    </main>`
  root.querySelector("button").textContent =
    `Sign in with ${PROVIDER_LABELS[provider] || provider}`
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
  prompt = (message, value) => window.prompt(message, value),
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
          <h1>Your programs</h1>
          <p>Before a link works, add this URL to the program's <strong>Publish</strong> page on GuidedTrack, under the pages allowed to run it:</p>
          <pre class="harness-setup-url"></pre>
          <form class="harness-register">
            <label>GuidedTrack key <input name="key" required pattern="[A-Za-z0-9]+" placeholder="abc1234" autocomplete="off" /></label>
            <label>Label (optional) <input name="label" placeholder="Sleep study v2" /></label>
            <button type="submit">Register program</button>
            <p class="harness-error" hidden></p>
          </form>
          <details class="harness-help">
            <summary>How can I find my program's key?</summary>
            <p>The key is the short identifier GuidedTrack gives every program. It appears in the program's URLs, for example the preview, test and run links:</p>
            <pre>https://www.guidedtrack.com/programs/&lt;KEY&gt;/preview
https://www.guidedtrack.com/programs/&lt;KEY&gt;/test
https://www.guidedtrack.com/programs/&lt;KEY&gt;/run</pre>
            <p>Copy the part that stands in for <code>&lt;KEY&gt;</code>.</p>
          </details>
          <section class="harness-programs"></section>
        </main>`
      root.querySelector(".harness-setup-url").textContent = pageUrl

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
        } catch (failure) {
          error.textContent =
            failure.code === "23505"
              ? "You already registered this program key."
              : failure.message
          error.hidden = false
          return
        }
        try {
          await mountDeveloper({
            root,
            store,
            provider,
            pageUrl,
            confirm,
            prompt,
          })
        } catch (failure) {
          renderErrorBanner(root, failure.message)
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
            <button type="button" data-action="rename">Rename</button>
            <button type="button" data-action="regenerate">Regenerate links</button>
            <button type="button" data-action="delete">Delete program</button>
          </p>
          <p class="harness-error" hidden></p>`
        renderProgramHeading(card.querySelector("h3"), program)
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
        const cardError = card.querySelector(".harness-error")
        const actionButtons = card.querySelectorAll(
          ".harness-card-actions button",
        )
        async function perform(label, request) {
          cardError.hidden = true
          for (const button of actionButtons) button.disabled = true
          try {
            await request()
          } catch (failure) {
            cardError.textContent = `Could not ${label}: ${failure.message}`
            cardError.hidden = false
            for (const button of actionButtons) button.disabled = false
            return
          }
          try {
            await mountDeveloper({
              root,
              store,
              provider,
              pageUrl,
              confirm,
              prompt,
            })
          } catch (failure) {
            renderErrorBanner(root, failure.message)
          }
        }
        card
          .querySelector('[data-action="rename"]')
          .addEventListener("click", () => {
            const next = prompt(
              "Name for this program (leave empty to show only its key):",
              program.label || "",
            )
            if (next === null) return
            perform("rename the program", () =>
              store.renameProgram(program.id, next),
            )
          })
        card
          .querySelector('[data-action="regenerate"]')
          .addEventListener("click", () => {
            if (
              !confirm(
                "Regenerate the links? New sessions cannot start with the old links. Sessions that are already open keep working until you delete them. Stored feedback is kept.",
              )
            )
              return
            perform("regenerate the links", () =>
              store.regenerateShare(program.id),
            )
          })
        card
          .querySelector('[data-action="delete"]')
          .addEventListener("click", () => {
            if (
              !confirm(
                `Delete "${programLabel(program)}" and all its feedback? This cannot be undone.`,
              )
            )
              return
            perform("delete the program", () => store.deleteProgram(program.id))
          })
        return card
      }
    },
  })
}
