import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

async function mount(page, key, mode) {
  return page.evaluate(
    async ({ key, mode }) => {
      window.events = []
      window.refused = 0
      const mounted = await window.harness.mountProgram({
        root: document.getElementById("root"),
        key,
        mode,
        assetBase: "/test/fixtures/gt-stub",
        onRefused: () => window.refused++,
      })
      for (const name of ["pageStart", "trace", "append", "pageEnd"]) {
        mounted.events.on(name, detail =>
          window.events.push({ name, detail: detail ?? null }),
        )
      }
      return mounted.container.outerHTML.slice(0, 200)
    },
    { key, mode },
  )
}

test("mounts the GT container, loads assets, and relays events", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/embed.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    await mount(page, "abc1234", "test")

    await page.waitForSelector(".program_container .main p")
    assert.equal(
      await page
        .locator("#abc1234.guidedtrack.program_container[data-mode=test]")
        .count(),
      1,
    )
    assert.equal(
      await page.locator("#program_navigation #back-button").count(),
      1,
    )
    assert.equal(
      await page
        .locator('link[href="/test/fixtures/gt-stub/guidedtrack.css"]')
        .count(),
      1,
    )
    assert.equal(
      await page
        .locator('link[href="/test/fixtures/gt-stub/bootstrap.css"]')
        .count(),
      1,
    )
    assert.match(
      await page.locator(".program_container .main").innerText(),
      /Welcome/,
    )

    await page.waitForFunction(() =>
      window.events.some(e => e.name === "pageEnd"),
    )
    const events = await page.evaluate(() => window.events)
    assert.deepEqual(
      events.map(e => e.name),
      ["pageStart", "trace", "trace", "append", "pageEnd"],
    )
    assert.deepEqual(events[1].detail, { from: 1, to: 3, program: "main" })

    await page.click(".program_container .main .next")
    await page.waitForFunction(
      () => window.events.filter(e => e.name === "pageEnd").length === 2,
    )
    const second = await page.evaluate(() => window.events.slice(5))
    assert.deepEqual(
      second.map(e => e.name),
      ["pageStart", "trace", "append", "pageEnd"],
    )
    assert.deepEqual(second[1].detail, { from: 20, to: 24, program: "helper" })
  })
})

test("run mode omits data-mode", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/embed.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    await mount(page, "abc1234", "run")
    assert.equal(
      await page.locator("#abc1234.program_container[data-mode]").count(),
      0,
    )
    assert.equal(await page.locator("#abc1234.program_container").count(), 1)
  })
})

test("reports a refused embed", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/embed.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    await mount(page, "refused", "test")
    await page.waitForFunction(() => window.refused === 1)
    assert.match(
      await page.locator(".program_container").innerText(),
      /not set up to run/,
    )
  })
})

test("rejects when a GT script cannot load", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/embed.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    const message = await page.evaluate(async () => {
      try {
        await window.harness.mountProgram({
          root: document.getElementById("root"),
          key: "abc1234",
          assetBase: "/test/fixtures/does-not-exist",
        })
        return "resolved"
      } catch (error) {
        return error.message
      }
    })
    assert.match(message, /Failed to load/)
  })
})

test("copies of GuidedTrack's font declarations are installed ahead of its stylesheets", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/embed.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    const result = await page.evaluate(async () => {
      const mounted = await window.harness.mountProgram({
        root: document.getElementById("root"),
        key: "abc1234",
        assetBase: "/test/fixtures/gt-stub",
        fontsUrl: "/test/fixtures/gt-fonts-fixture.css",
      })
      await mounted.fontsInstalled
      const style = document.head.querySelector("style[data-harness-fonts]")
      const order = [...document.head.children]
        .filter(el =>
          el.matches("style[data-harness-fonts], link[rel=stylesheet]"),
        )
        .map(el => el.tagName.toLowerCase())
      return { text: style?.textContent, order }
    })
    assert.match(result.text, /HarnessBox/)
    assert.equal(result.order[0], "style")
    assert.ok(result.order.includes("link"))
  })
})

test("a missing font copy is ignored", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/embed.html`)
    await page.waitForFunction(() => window.fixtureReady === true)
    const count = await page.evaluate(async () => {
      const mounted = await window.harness.mountProgram({
        root: document.getElementById("root"),
        key: "abc1234",
        assetBase: "/test/fixtures/gt-stub",
        fontsUrl: "/test/fixtures/does-not-exist.css",
      })
      await mounted.fontsInstalled
      return document.head.querySelectorAll("style[data-harness-fonts]").length
    })
    assert.equal(count, 0)
  })
})
