import "../../src/styles.css"
import { createEditor, TOOLS } from "../../src/annotations/editor.js"
import { flattenToPng } from "../../src/annotations/flatten.js"
import { renderTree, toSvgString } from "../../src/annotations/render.js"
import { captureViewport } from "../../src/capture.js"
import { mountProgram, createEmitter } from "../../src/gt-embed.js"
import { createControls } from "../../src/controls.js"
import { openFeedbackModal } from "../../src/feedback-modal.js"
import { mountDeveloper } from "../../src/screens/developer.js"
import { mountAccount } from "../../src/screens/account.js"
import { mountInbox } from "../../src/screens/inbox.js"
import { mountSession } from "../../src/screens/session.js"
import { mountReviewer } from "../../src/screens/reviewer.js"
import { runReviewer } from "../../src/screens/reviewer-flow.js"
import { createStore } from "../../src/store.js"
import { createFakeStore } from "./fake-store.js"
import { pixelAt } from "./pixel.js"

window.harness = {
  version: "phase-2",
  createEditor,
  TOOLS,
  flattenToPng,
  renderTree,
  toSvgString,
  captureViewport,
  mountProgram,
  createEmitter,
  createControls,
  openFeedbackModal,
  mountDeveloper,
  mountAccount,
  mountInbox,
  mountSession,
  mountReviewer,
  runReviewer,
  createStore,
  createFakeStore,
  pixelAt,
}
