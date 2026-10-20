import { programLabel } from "../format.js"

// Fills a heading with the program's label and, when it has one, its
// GuidedTrack key in smaller text beside it; a program without a label shows
// the key alone.
export function renderProgramHeading(element, program) {
  element.replaceChildren(programLabel(program))
  if (program.label) {
    const key = document.createElement("small")
    key.className = "harness-key"
    key.textContent = program.gt_key
    element.append(" ", key)
  }
}
