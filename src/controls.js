export function createControls({ root, onFeedback, name = null }) {
  const element = document.createElement("div")
  element.className = "harness-controls"
  element.setAttribute("data-harness-chrome", "")
  element.innerHTML = `
    <button type="button" class="harness-feedback-button">
      <span class="harness-feedback-icon" aria-hidden="true">&#x1F4AC;</span>
      <span class="harness-feedback-label">Give feedback</span>
    </button>
    ${
      name
        ? '<label class="harness-name"><span>Your name (optional)</span><input type="text" placeholder="Name" /></label>'
        : ""
    }
  `

  const button = element.querySelector(".harness-feedback-button")
  const label = element.querySelector(".harness-feedback-label")
  button.addEventListener("click", () => onFeedback())

  if (name) {
    const input = element.querySelector("input")
    input.value = name.value || ""
    input.addEventListener("change", () => name.onChange(input.value.trim()))
  }

  root.appendChild(element)

  return {
    element,
    // Taking the screenshot can take a few seconds on pages with images, so
    // the button says what it is waiting for.
    setBusy(busy) {
      button.disabled = busy
      label.textContent = busy ? "Taking screenshot\u2026" : "Give feedback"
    },
    remove() {
      element.remove()
    },
  }
}
