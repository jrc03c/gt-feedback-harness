import { withDeveloper } from "./developer.js"
import { formatDate, formatDuration, programLabel } from "../format.js"

export async function mountInbox({
  root,
  store,
  programId,
  confirm = message => window.confirm(message),
}) {
  await withDeveloper({
    root,
    store,
    render: async () => {
      const [program, sessions] = await Promise.all([
        store.getProgram(programId),
        store.listSessions(programId),
      ])
      root.innerHTML = `
        <main class="harness-home harness-inbox">
          <p><a href="?dev">All programs</a></p>
          <h1></h1>
          <label><input type="checkbox" /> Only sessions with unresolved items</label>
          <table>
            <thead><tr><th>Reviewer</th><th>Mode</th><th>Started</th><th>Duration</th><th>Feedback</th><th></th></tr></thead>
            <tbody></tbody>
          </table>
          <p class="harness-error" hidden></p>
          <p class="harness-empty" hidden>No sessions yet. Share the program's links to get feedback.</p>
        </main>`
      root.querySelector("h1").textContent =
        `${programLabel(program)} (${program.gt_key})`
      const tbody = root.querySelector("tbody")
      const errorBox = root.querySelector(".harness-error")
      const filter = root.querySelector("input[type=checkbox]")

      function draw() {
        tbody.replaceChildren()
        const shown = filter.checked
          ? sessions.filter(s => s.unresolved_count > 0)
          : sessions
        root.querySelector(".harness-empty").hidden = shown.length > 0
        for (const session of shown) {
          const row = document.createElement("tr")
          row.innerHTML = `<td></td><td></td><td></td><td></td><td></td><td><a></a> <button type="button" data-action="delete">Delete</button></td>`
          const cells = row.querySelectorAll("td")
          cells[0].textContent = session.reviewer_name || "Anonymous"
          cells[1].textContent = session.mode
          cells[2].textContent = formatDate(session.started_at)
          cells[3].textContent = formatDuration(
            session.started_at,
            session.last_seen_at,
          )
          cells[4].textContent =
            `${session.item_count} item${session.item_count === 1 ? "" : "s"}` +
            (session.unresolved_count
              ? ` (${session.unresolved_count} unresolved)`
              : "")
          const open = row.querySelector("a")
          open.href = `?session=${encodeURIComponent(session.id)}`
          open.textContent = "Open"
          const deleteButton = row.querySelector('[data-action="delete"]')
          deleteButton.addEventListener("click", async () => {
            if (
              !confirm(
                "Delete this session and its feedback? This cannot be undone.",
              )
            )
              return
            deleteButton.disabled = true
            errorBox.hidden = true
            try {
              await store.deleteSession(session.id)
              const index = sessions.indexOf(session)
              if (index !== -1) sessions.splice(index, 1)
              draw()
            } catch (error) {
              errorBox.textContent = `Could not delete the session: ${error.message}`
              errorBox.hidden = false
              deleteButton.disabled = false
            }
          })
          tbody.appendChild(row)
        }
      }
      filter.addEventListener("change", draw)
      draw()
    },
  })
}
