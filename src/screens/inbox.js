import { withDeveloper } from "./developer.js"
import { formatDate, formatDuration } from "../format.js"
import { renderProgramHeading } from "./heading.js"
import { sortSessions } from "./inbox-sort.js"

const COLUMNS = [
  ["reviewer", "Reviewer"],
  ["mode", "Mode"],
  ["started", "Started"],
  ["duration", "Duration"],
  ["feedback", "Feedback"],
]

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
            <thead><tr></tr></thead>
            <tbody></tbody>
          </table>
          <p class="harness-error" hidden></p>
          <p class="harness-empty" hidden>No sessions yet. Share the program's links to get feedback.</p>
        </main>`
      renderProgramHeading(root.querySelector("h1"), program)
      const tbody = root.querySelector("tbody")
      const errorBox = root.querySelector(".harness-error")
      const filter = root.querySelector("input[type=checkbox]")
      let sort = { column: "started", direction: "desc" }

      const headRow = root.querySelector("thead tr")
      for (const [column, label] of COLUMNS) {
        const th = document.createElement("th")
        th.dataset.sort = column
        const button = document.createElement("button")
        button.type = "button"
        button.textContent = label
        button.addEventListener("click", () => {
          sort =
            sort.column === column
              ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
              : {
                  column,
                  direction:
                    column === "reviewer" || column === "mode" ? "asc" : "desc",
                }
          draw()
        })
        th.appendChild(button)
        headRow.appendChild(th)
      }
      headRow.appendChild(document.createElement("th"))

      function drawHeaders() {
        for (const th of headRow.querySelectorAll("th[data-sort]")) {
          const active = th.dataset.sort === sort.column
          if (active)
            th.setAttribute(
              "aria-sort",
              sort.direction === "asc" ? "ascending" : "descending",
            )
          else th.removeAttribute("aria-sort")
        }
      }

      function draw() {
        drawHeaders()
        tbody.replaceChildren()
        const shown = sortSessions(
          filter.checked
            ? sessions.filter(s => s.unresolved_count > 0)
            : sessions,
          sort.column,
          sort.direction,
        )
        root.querySelector(".harness-empty").hidden = shown.length > 0
        for (const session of shown) {
          const row = document.createElement("tr")
          row.classList.toggle(
            "harness-unresolved",
            session.unresolved_count > 0,
          )
          row.innerHTML = `<td></td><td></td><td></td><td></td><td></td><td class="harness-row-actions"><a></a><button type="button" data-action="delete">Delete</button></td>`
          const cells = row.querySelectorAll("td")
          cells[0].textContent = session.reviewer_name || "Anonymous"
          cells[1].textContent = session.mode
          cells[2].textContent = formatDate(session.started_at)
          cells[3].textContent = formatDuration(
            session.started_at,
            session.last_seen_at,
          )
          cells[4].className = "harness-feedback-cell"
          cells[4].textContent = `${session.item_count} item${session.item_count === 1 ? "" : "s"} `
          if (session.unresolved_count) {
            const badge = document.createElement("span")
            badge.className = "harness-badge"
            badge.textContent = `${session.unresolved_count} unresolved`
            cells[4].appendChild(badge)
          }
          const open = row.querySelector("a")
          open.href = `?session=${encodeURIComponent(session.id)}`
          open.textContent = "View"
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
