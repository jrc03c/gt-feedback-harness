import { withDeveloper } from "./developer.js"
import { userLabel } from "../format.js"
import { OAUTH_PROVIDER } from "../config.js"
import { harnessPageUrl, renderErrorBanner } from "./banners.js"

export async function mountAccount({
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
      root.innerHTML = `
        <main class="harness-home harness-account">
          <p><a href="?dev">All programs</a></p>
          <h1>Your account</h1>
          <dl>
            <dt>Signed in as</dt><dd class="harness-account-name"></dd>
            <dt>Email</dt><dd class="harness-account-email"></dd>
          </dl>
          <section class="harness-danger-zone">
            <h2>Delete account</h2>
            <p>Deleting your account removes every program you registered, all of their sessions and feedback, and all screenshots. Signing in with GitHub again afterwards starts a fresh account.</p>
            <button type="button" class="harness-danger" data-action="delete-account">Delete account</button>
            <p class="harness-error" hidden></p>
          </section>
        </main>`
      root.querySelector(".harness-account-name").textContent = userLabel(user)
      root.querySelector(".harness-account-email").textContent =
        user.email || "(none)"
      const button = root.querySelector('[data-action="delete-account"]')
      const errorBox = root.querySelector(".harness-error")
      button.addEventListener("click", async () => {
        if (
          !confirm(
            "Delete your account? This removes all your programs, their sessions and feedback, and all screenshots. It cannot be undone.",
          )
        )
          return
        button.disabled = true
        errorBox.hidden = true
        try {
          // Signing out at the end triggers the auth listener, which shows
          // the sign-in prompt.
          await store.deleteAccount()
        } catch (failure) {
          errorBox.textContent = `Could not delete the account: ${failure.message}`
          errorBox.hidden = false
          button.disabled = false
        }
      })
    },
  })
}
