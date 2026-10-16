export function harnessPageUrl(location = window.location) {
  return location.origin + location.pathname.replace(/index\.html$/, "")
}

export function renderRefusalBanner(root, url = harnessPageUrl()) {
  root.innerHTML = `
    <div class="harness-banner" role="alert">
      <h2>This program isn't set up for the harness yet</h2>
      <p>On GuidedTrack, open the program's <strong>Publish</strong> page and add this URL to the list of pages allowed to run it:</p>
      <pre class="harness-url"></pre>
      <p>Then <button type="button" class="harness-reload">reload this page</button>.</p>
    </div>`
  root.querySelector(".harness-url").textContent = url
  root
    .querySelector(".harness-reload")
    .addEventListener("click", () => window.location.reload())
}

export function renderErrorBanner(root, message) {
  root.innerHTML = `
    <div class="harness-banner" role="alert">
      <h2>Something went wrong</h2>
      <p class="harness-message"></p>
    </div>`
  root.querySelector(".harness-message").textContent = message
}

export function renderInvalidLinkBanner(root) {
  root.innerHTML = `
    <div class="harness-banner" role="alert">
      <h2>This feedback link isn't valid</h2>
      <p class="harness-message">The link may have been regenerated or the program removed. Ask the developer for a new link.</p>
    </div>`
}
