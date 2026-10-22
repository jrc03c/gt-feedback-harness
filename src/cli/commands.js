// The command line's commands, each returning plain data for JSON output.
// Everything that touches the outside world is injected: the harness store,
// the GuidedTrack client (optional), the file writer, and the flattener.
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { overlaySvg } from "./flatten.js"
import { shareLinks } from "../links.js"

const defaultFiles = {
  mkdir: dir => mkdir(dir, { recursive: true }),
  write: (file, data) => writeFile(file, data),
}

export function createCommands({
  store,
  guidedtrack = null,
  files = defaultFiles,
  pageUrl,
  flatten = async () => null,
}) {
  const summary = program => ({
    id: program.id,
    gt_key: program.gt_key,
    label: program.label,
    share_id: program.share_id,
  })

  async function findRegistered(term) {
    const programs = await store.listPrograms()
    const program = programs.find(p => p.id === term || p.gt_key === term)
    if (!program) {
      throw new Error(
        `No registered program has the id or key "${term}". Run setup first, or list programs.`,
      )
    }
    return program
  }

  return {
    async setup(term, { label } = {}) {
      let gtProgram = null
      let pageAdded = null
      if (guidedtrack) {
        gtProgram = await guidedtrack.findProgram(term)
        if (!gtProgram) {
          throw new Error(`No GuidedTrack program is named or keyed "${term}".`)
        }
        pageAdded = await guidedtrack.allowPage(gtProgram.id, pageUrl)
      } else if (!/^[A-Za-z0-9]{1,32}$/.test(term)) {
        throw new Error(
          `"${term}" is not a program key. Set GT_EMAIL and GT_PASSWORD to look programs up by name and to allow the harness page automatically.`,
        )
      }
      const key = gtProgram ? gtProgram.key : term
      const programs = await store.listPrograms()
      let program = programs.find(p => p.gt_key === key)
      const registered = !program
      if (registered) {
        program = await store.registerProgram({
          gtKey: key,
          label: label || (gtProgram ? gtProgram.name : ""),
        })
      }
      return {
        program: summary(program),
        guidedtrack: gtProgram
          ? { id: gtProgram.id, key: gtProgram.key, name: gtProgram.name }
          : null,
        links: shareLinks(pageUrl, program.share_id),
        page_added: pageAdded,
        registered,
      }
    },

    async programs() {
      return (await store.listPrograms()).map(program => ({
        ...summary(program),
        session_count: program.session_count,
        unresolved_count: program.unresolved_count,
        links: shareLinks(pageUrl, program.share_id),
      }))
    },

    async sessions(term) {
      const program = await findRegistered(term)
      return store.listSessions(program.id)
    },

    async feedback(term, { all = false, out = "feedback" } = {}) {
      const program = await findRegistered(term)
      const sessions = await store.listSessions(program.id)
      const items = []
      let flattenFailed = false
      for (const session of sessions) {
        for (const item of await store.listItems(session.id)) {
          if (!all && item.resolved_at) continue
          let written = null
          if (item.screenshot_path) {
            if (items.length === 0) await files.mkdir(out)
            const base = path.join(out, item.id)
            const blob = await store.downloadScreenshot(item.screenshot_path)
            await files.write(
              `${base}.webp`,
              Buffer.from(await blob.arrayBuffer()),
            )
            const size = item.image_size || { width: 0, height: 0 }
            await files.write(
              `${base}.svg`,
              overlaySvg(item.annotations || [], size),
            )
            const annotated = await flatten({
              raw: `${base}.webp`,
              overlay: `${base}.svg`,
              out: `${base}.png`,
              width: size.width,
              height: size.height,
            })
            if (!annotated) flattenFailed = true
            written = {
              screenshot: `${base}.webp`,
              overlay: `${base}.svg`,
              annotated,
            }
          }
          items.push({
            id: item.id,
            session: {
              id: session.id,
              reviewer_name: session.reviewer_name,
              mode: session.mode,
              started_at: session.started_at,
            },
            created_at: item.created_at,
            resolved_at: item.resolved_at,
            text: item.text,
            annotations: item.annotations,
            context: item.context,
            files: written,
          })
        }
      }
      const result = { program: summary(program), items }
      if (flattenFailed && flatten.unavailable)
        result.warning = flatten.unavailable
      return result
    },

    async resolve(itemId) {
      await store.setResolved(itemId, true)
      return { id: itemId, resolved: true }
    },

    async unresolve(itemId) {
      await store.setResolved(itemId, false)
      return { id: itemId, resolved: false }
    },
  }
}
