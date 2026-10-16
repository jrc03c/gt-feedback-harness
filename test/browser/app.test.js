import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

test("the app shows the developer sign-in at the root and the invalid-link banner for a bad share id", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.route(/supabase\.co/, route => {
      if (route.request().url().includes("/auth/v1/signup")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: "t",
            token_type: "bearer",
            expires_in: 3600,
            refresh_token: "r",
            user: {
              id: "anon",
              is_anonymous: true,
              aud: "authenticated",
              role: "authenticated",
            },
          }),
        })
      }
      if (route.request().url().includes("/rest/v1/rpc/resolve_share")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        })
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      })
    })
    await page.goto(`${baseUrl}/index.html`)
    await page.waitForSelector(".harness-signin")
    await page.goto(
      `${baseUrl}/index.html?r=NOPENOPENOPENOPENOPENOPE&mode=test`,
    )
    await page.waitForSelector(".harness-banner")
    assert.match(
      await page.locator(".harness-banner h2").innerText(),
      /isn't valid/,
    )
  })
})
