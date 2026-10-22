import { createClient } from "@supabase/supabase-js"
import { newShareId } from "./share-id.js"

export const SCREENSHOT_BUCKET = "screenshots"

function unwrap({ data, error }) {
  if (error) {
    // Real Supabase errors are Error instances; wrap plain objects so callers
    // (and assert.rejects) always get an Error with the original fields.
    throw error instanceof Error
      ? error
      : Object.assign(new Error(error.message), error)
  }
  return data
}

export function createStore({
  url,
  anonKey,
  client = createClient(url, anonKey),
}) {
  async function currentUser() {
    const { data } = await client.auth.getSession()
    return data.session ? data.session.user : null
  }

  async function requireUser() {
    const user = await currentUser()
    if (!user) throw new Error("Not signed in")
    return user
  }

  const PAGE = 1000

  // Removes every screenshot in the session's folder, then the row. Storage
  // lists at most PAGE objects per call, so collect all pages before removing.
  async function deleteSession(sessionId) {
    const bucket = () => client.storage.from(SCREENSHOT_BUCKET)
    const paths = []
    for (let offset = 0; ; offset += PAGE) {
      const objects =
        unwrap(await bucket().list(sessionId, { limit: PAGE, offset })) || []
      paths.push(...objects.map(o => `${sessionId}/${o.name}`))
      if (objects.length < PAGE) break
    }
    for (let i = 0; i < paths.length; i += PAGE) {
      unwrap(await bucket().remove(paths.slice(i, i + PAGE)))
    }
    unwrap(await client.from("sessions").delete().eq("id", sessionId))
  }

  const api = {
    client,

    // Auth
    async signInAnonymously() {
      const existing = await currentUser()
      if (existing) return existing
      return unwrap(await client.auth.signInAnonymously()).user
    },
    getUser: currentUser,
    async signInWithProvider(provider, redirectTo) {
      unwrap(
        await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo },
        }),
      )
    },
    // For scripts: signs in with the email and a script password.
    async signInWithPassword(email, password) {
      return unwrap(await client.auth.signInWithPassword({ email, password }))
        .user
    },
    // Gives the signed-in developer a fresh random password for scripts,
    // replacing any earlier one, and returns it with the account's email.
    async setScriptPassword() {
      const user = await requireUser()
      const password = newShareId(32)
      unwrap(await client.auth.updateUser({ password }))
      return { email: user.email, password }
    },
    async signOut() {
      unwrap(await client.auth.signOut())
    },
    onAuthChange(fn) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        fn(session ? session.user : null)
      })
      return data.subscription
    },

    // Reviewer side
    async resolveShare(shareId) {
      const rows =
        unwrap(await client.rpc("resolve_share", { share: shareId })) || []
      return rows.length
        ? { programId: rows[0].program_id, gtKey: rows[0].gt_key }
        : null
    },
    async createSession({
      programId,
      shareId,
      mode,
      reviewerName = "",
      userAgent,
      viewport,
    }) {
      const user = await requireUser()
      const row = unwrap(
        await client
          .from("sessions")
          .insert({
            program_id: programId,
            share_id: shareId,
            reviewer_uid: user.id,
            reviewer_name: reviewerName,
            mode,
            user_agent: userAgent,
            viewport,
          })
          .select("id")
          .single(),
      )
      return row.id
    },
    async touchSession(sessionId, { reviewerName } = {}) {
      const patch = { last_seen_at: new Date().toISOString() }
      if (reviewerName !== undefined) patch.reviewer_name = reviewerName
      unwrap(await client.from("sessions").update(patch).eq("id", sessionId))
    },
    async sendItem(sessionId, item) {
      const id = crypto.randomUUID()
      const path = `${sessionId}/${id}.webp`
      unwrap(
        await client.storage
          .from(SCREENSHOT_BUCKET)
          .upload(path, item.image.blob, {
            contentType: item.image.blob.type || "image/webp",
            upsert: false,
          }),
      )
      unwrap(
        await client.from("items").insert({
          id,
          session_id: sessionId,
          text: item.text,
          annotations: item.annotations,
          context: item.context,
          screenshot_path: path,
          image_size: {
            width: item.image.width,
            height: item.image.height,
            scale: item.image.scale,
          },
        }),
      )
      return id
    },

    // Developer side
    async listPrograms() {
      return (
        unwrap(
          await client
            .from("program_overview")
            .select("*")
            .order("created_at", { ascending: false }),
        ) || []
      )
    },
    async getProgram(programId) {
      return unwrap(
        await client
          .from("program_overview")
          .select("*")
          .eq("id", programId)
          .single(),
      )
    },
    async registerProgram({ gtKey, label }) {
      const user = await requireUser()
      return unwrap(
        await client
          .from("programs")
          .insert({
            owner_id: user.id,
            gt_key: gtKey.trim(),
            label: (label || "").trim() || null,
            share_id: newShareId(),
          })
          .select("*")
          .single(),
      )
    },
    // Changes only the label; an empty name clears it so the key shows alone.
    async renameProgram(programId, label) {
      const next = (label || "").trim() || null
      unwrap(
        await client
          .from("programs")
          .update({ label: next })
          .eq("id", programId),
      )
      return next
    },
    async regenerateShare(programId) {
      const shareId = newShareId()
      unwrap(
        await client
          .from("programs")
          .update({ share_id: shareId })
          .eq("id", programId),
      )
      return shareId
    },
    // Removes every program (screenshots first, then rows), then the user
    // itself through delete_account(), then signs out. Signing in again with
    // the same GitHub account afterwards creates a fresh user.
    async deleteAccount() {
      const programs = (await api.listPrograms()) || []
      for (const program of programs) await api.deleteProgram(program.id)
      unwrap(await client.rpc("delete_account"))
      await api.signOut()
    },
    async deleteProgram(programId) {
      const sessions =
        unwrap(
          await client
            .from("sessions")
            .select("id")
            .eq("program_id", programId),
        ) || []
      for (const session of sessions) await deleteSession(session.id)
      unwrap(await client.from("programs").delete().eq("id", programId))
    },
    async listSessions(programId) {
      const rows =
        unwrap(
          await client
            .from("sessions")
            .select("*, items(id, resolved_at)")
            .eq("program_id", programId)
            .order("started_at", { ascending: false }),
        ) || []
      return rows.map(({ items = [], ...session }) => ({
        ...session,
        item_count: items.length,
        unresolved_count: items.filter(item => !item.resolved_at).length,
      }))
    },
    async getSession(sessionId) {
      return unwrap(
        await client
          .from("sessions")
          .select("*, programs(gt_key, label)")
          .eq("id", sessionId)
          .single(),
      )
    },
    async listItems(sessionId) {
      return (
        unwrap(
          await client
            .from("items")
            .select("*")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: true }),
        ) || []
      )
    },
    async downloadScreenshot(path) {
      return unwrap(await client.storage.from(SCREENSHOT_BUCKET).download(path))
    },
    async setResolved(itemId, resolved) {
      unwrap(
        await client
          .from("items")
          .update({ resolved_at: resolved ? new Date().toISOString() : null })
          .eq("id", itemId),
      )
    },
    deleteSession,
  }
  return api
}
