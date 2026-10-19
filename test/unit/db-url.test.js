import { test } from "node:test"
import assert from "node:assert/strict"
import { databaseUrl } from "../../scripts/db-url.mjs"

const template =
  "postgresql://postgres.ref:[YOUR-PASSWORD]@pooler.example:5432/postgres"
const noFile = "/nonexistent/.env"

test("SUPABASE_DB_URL wins over everything else", () => {
  const env = {
    SUPABASE_DB_URL: "postgresql://direct",
    SUPABASE_DB_URL_TEMPLATE: template,
    SUPABASE_DB_PASSWORD: "x",
  }
  assert.equal(databaseUrl(env, noFile), "postgresql://direct")
})

test("the template and password can come from the environment, with the password URL-encoded", () => {
  const env = {
    SUPABASE_DB_URL_TEMPLATE: template,
    SUPABASE_DB_PASSWORD: "p@ss w#rd",
  }
  assert.equal(
    databaseUrl(env, noFile),
    "postgresql://postgres.ref:p%40ss%20w%23rd@pooler.example:5432/postgres",
  )
})

test("a template without the placeholder is rejected", () => {
  const env = {
    SUPABASE_DB_URL_TEMPLATE: "postgresql://nope",
    SUPABASE_DB_PASSWORD: "x",
  }
  assert.throws(() => databaseUrl(env, noFile), /\[YOUR-PASSWORD\]/)
})

test("returns null when neither the environment nor the file has the values", () => {
  assert.equal(databaseUrl({}, noFile), null)
})
