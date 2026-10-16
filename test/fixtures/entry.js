import "../../src/styles.css"
import { createEditor, TOOLS } from "../../src/annotations/editor.js"
import { flattenToPng } from "../../src/annotations/flatten.js"
import { captureViewport } from "../../src/capture.js"
import { mountProgram, createEmitter } from "../../src/gt-embed.js"
import { createControls } from "../../src/controls.js"
import { openFeedbackModal } from "../../src/feedback-modal.js"
import { mountDeveloper } from "../../src/screens/developer.js"
import { mountReviewer } from "../../src/screens/reviewer.js"
import { runReviewer } from "../../src/screens/reviewer-flow.js"
import { downloadFeedback } from "../../src/send-local.js"
import { createStore } from "../../src/store.js"
import { createFakeStore } from "./fake-store.js"
import { pixelAt } from "./pixel.js"

window.harness = {
  version: "phase-1",
  createEditor,
  TOOLS,
  flattenToPng,
  captureViewport,
  mountProgram,
  createEmitter,
  createControls,
  openFeedbackModal,
  mountDeveloper,
  mountReviewer,
  runReviewer,
  downloadFeedback,
  createStore,
  createFakeStore,
  pixelAt,
}
