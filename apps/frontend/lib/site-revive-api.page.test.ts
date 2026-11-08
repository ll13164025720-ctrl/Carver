import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { afterEach, before, beforeEach, describe, it } from "node:test"

import {
  SiteReviveApiError,
  clearCaptureCache,
  editWebsite,
  fetchLatestProject,
  fetchVersion,
  fetchVersionHistory,
  isMockMode,
  normalizeResult,
  redesignWebsite,
} from "@/lib/site-revive-api"
import { startRedesignJob } from "@/lib/redesign-job"
import type { WebsiteBlueprint, WebsiteCapture } from "@/types/backend"
import type { GeneratedPage, SiteContent } from "@/types/website"

/**
 * The current backend format: generate and edit return `website: { html, css,
 * javascript }`, and an edit is { projectId, baseVersion, prompt }. `fetch` is
 * stubbed, so nothing here touches a network or a model. (The recorded page in
 * lib/fixtures was written by the real model; everything else is built here.)
 */

const API = "http://localhost:3001"
const SITE = "https://joescafe.com/"
const PROJECT = "69112fc8-f065-40e3-a706-99a23e69a8ad"
const env = process.env as Record<string, string | undefined>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Call {
  path: string
  method: string
  url: string
  body: Record<string, unknown>
  init: RequestInit
}
type Reply = { status?: number; json?: unknown; text?: string }
type Handler = (call: Call) => Reply | Promise<Reply>

const realFetch = globalThis.fetch
let calls: Call[] = []

function installFetch(handler: Handler) {
  calls = []
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const call: Call = {
      url,
      path: new URL(url).pathname,
      method: String(init.method ?? "GET"),
      body: init.body ? JSON.parse(String(init.body)) : {},
      init,
    }
    calls.push(call)
    const reply = await handler(call)
    return new Response(reply.text ?? JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 })
  }) as typeof fetch
}

function setEnvironment(settings: { mode?: string; url?: string }) {
  for (const [key, value] of [
    ["NEXT_PUBLIC_SITE_REVIVE_API_MODE", settings.mode],
    ["NEXT_PUBLIC_SITE_REVIVE_API_URL", settings.url],
    ["NEXT_PUBLIC_SITE_REVIVE_SCREENSHOT_BASE_URL", undefined],
  ] as const) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
}

async function rejection(promise: Promise<unknown>): Promise<SiteReviveApiError> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof SiteReviveApiError, `expected SiteReviveApiError, got ${String(error)}`)
    return error
  }
  throw new assert.AssertionError({ message: "expected the promise to reject" })
}

function pageOf(content: SiteContent): GeneratedPage {
  assert.equal(content.kind, "page")
  return (content as Extract<SiteContent, { kind: "page" }>).page
}

const WORKER_ID = "1bd89974-ee3d-4b89-b0f2-2138fad9724b"
const capture = (overrides: Partial<WebsiteCapture> = {}): WebsiteCapture => ({
  captureId: WORKER_ID,
  sourceUrl: SITE,
  finalUrl: "https://www.joescafe.com/",
  capturedAt: "2026-11-08T10:00:00.000Z",
  title: "Home | Joe's Café",
  description: "Coffee since 2014.",
  headings: [{ level: 1, text: "Joe's Café" }],
  text: "Long page text.",
  links: [],
  images: [{ src: "https://www.joescafe.com/photos/front.jpg", alt: "The front" }],
  screenshots: {
    desktop: `http://localhost:3002/artifacts/${WORKER_ID}-desktop.png`,
    mobile: `http://localhost:3002/artifacts/${WORKER_ID}-mobile.png`,
  },
  ...overrides,
})

const FIXTURE: GeneratedPage = JSON.parse(
  readFileSync(new URL("./fixtures/real-generated-website.json", import.meta.url), "utf8")
).website

const PAGE_V1: GeneratedPage = {
  html: '<h1 id="title">Joe\'s Café</h1><button id="toggle" type="button">Menu</button><p id="panel" hidden>Espresso</p>',
  css: "body{margin:0}",
  javascript: "document.getElementById('toggle').addEventListener('click',function(){var p=document.getElementById('panel');p.hidden=!p.hidden;});",
}
const PAGE_V2: GeneratedPage = { ...PAGE_V1, html: PAGE_V1.html.replace("Joe's Café", "Welcome to Our Cafe") }

const CAPTURE_REPLY = (): Reply => ({
  json: { ok: true, projectId: PROJECT, capture: capture(), sourceContent: '{"homepage":{}}', screenshotKeys: {} },
})
const GENERATE_REPLY = (website: unknown = PAGE_V1, versionNumber = 1): Reply => ({
  json: { ok: true, projectId: PROJECT, versionNumber, website },
})
const happy: Handler = ({ path }) => (path === "/api/captures" ? CAPTURE_REPLY() : GENERATE_REPLY())

const quiet = console.warn
before(() => {
  console.warn = () => {}
})
beforeEach(() => {
  clearCaptureCache()
  setEnvironment({ mode: "api", url: API })
})
afterEach(() => {
  globalThis.fetch = realFetch
  setEnvironment({})
})
process.on("exit", () => {
  console.warn = quiet
})

// ---------------------------------------------------------------------------
// Normalizing both formats
// ---------------------------------------------------------------------------

describe("normalizeResult: one internal representation for both formats", () => {
  const BLUEPRINT: WebsiteBlueprint = {
    schemaVersion: "1.0",
    siteId: "demo-site",
    slug: "joes-cafe",
    businessName: "Joe's Café",
    description: "",
    theme: { primaryColor: "#7A3E1D", secondaryColor: "#2F4A3A", fontFamily: "Lora" },
    sections: [
      { id: "header-main", type: "header", visible: true, content: {} },
      { id: "hero-main", type: "hero", visible: true, content: { headline: "Coffee" } },
      { id: "footer-main", type: "footer", visible: true, content: {} },
    ],
  }

  it("turns `website` into a page", () => {
    const result = normalizeResult({ website: PAGE_V1 })
    assert.ok(result.ok)
    assert.deepEqual(result.content, { kind: "page", page: PAGE_V1 })
  })

  it("turns an earlier-format `blueprint` into a design that keeps the blueprint", () => {
    const result = normalizeResult({ blueprint: BLUEPRINT }, capture())
    assert.ok(result.ok)
    assert.equal(result.content.kind, "design")
    if (result.content.kind === "design") {
      assert.equal(result.content.design.hero.headline, "Coffee")
      assert.deepEqual(result.content.blueprint, BLUEPRINT)
    }
  })

  it("prefers the page when an answer has both", () => {
    const result = normalizeResult({ website: PAGE_V1, blueprint: BLUEPRINT })
    assert.ok(result.ok && result.content.kind === "page")
  })

  it("rejects an answer that has neither, with a reason", () => {
    for (const body of [{}, { ok: true }, { website: undefined, blueprint: null }, null, "text", 5, []]) {
      const result = normalizeResult(body)
      assert.equal(result.ok, false, JSON.stringify(body))
      if (!result.ok) assert.ok(result.error.length > 0)
    }
  })

  it("rejects an invalid page or blueprint instead of falling back to the other kind", () => {
    assert.equal(normalizeResult({ website: { html: "<script>1</script>", css: "", javascript: "" }, blueprint: BLUEPRINT }).ok, false)
    assert.equal(normalizeResult({ website: PAGE_V1, blueprint: { nope: true } }).ok, true, "a valid page wins")
    assert.equal(normalizeResult({ blueprint: { nope: true } }).ok, false)
  })
})

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

describe("generation of a page", () => {
  it("URL only: no redesignPrompt is sent", async () => {
    installFetch(happy)
    const result = await redesignWebsite(SITE)

    assert.deepEqual(calls.map((c) => c.path), ["/api/captures", "/api/blueprints/generate"])
    assert.equal("redesignPrompt" in calls[1].body, false)
    assert.equal(calls[1].body.projectId, PROJECT)
    assert.deepEqual(pageOf(result.content), PAGE_V1)
    assert.equal(result.projectId, PROJECT)
    assert.equal(result.versionNumber, 1)
  })

  it("an empty or blank design direction behaves exactly like URL only", async () => {
    for (const instruction of ["", "   ", "\n\t "]) {
      clearCaptureCache()
      installFetch(happy)
      await redesignWebsite(SITE, { instruction })
      assert.equal("redesignPrompt" in calls[1].body, false, JSON.stringify(instruction))
    }
  })

  it("with a design direction: it is sent to the generate request, trimmed", async () => {
    const instruction = "Create a clean, modern café website with warm colors and a clear menu section."
    installFetch(happy)
    await redesignWebsite(SITE, { instruction: `  ${instruction}\n` })

    assert.equal(calls[1].path, "/api/blueprints/generate")
    assert.equal(calls[1].body.redesignPrompt, instruction)
    assert.equal(calls[0].path, "/api/captures")
    assert.equal("redesignPrompt" in calls[0].body, false, "the capture request carries no design direction")
  })

  it("never sends more than the backend accepts", async () => {
    installFetch(happy)
    await redesignWebsite(SITE, { instruction: "x".repeat(5000) })
    assert.equal((calls[1].body.redesignPrompt as string).length, 1000)
  })

  it("sends the design direction through the job runner the processing screen uses", async () => {
    installFetch(happy)
    const job = startRedesignJob("https://runner.example/", { instruction: "Make it bold" })
    await job.promise
    assert.equal(calls[1].body.redesignPrompt, "Make it bold")
  })

  it("a different direction for the same address is a different job, the same direction is shared", async () => {
    installFetch(async (call) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return happy(call)
    })
    const a = startRedesignJob("https://dup.example/", { instruction: "A" })
    const again = startRedesignJob("https://dup.example/", { instruction: "A" })
    const b = startRedesignJob("https://dup.example/", { instruction: "B" })
    assert.equal(a, again)
    assert.notEqual(a, b)
    await Promise.all([a.promise, b.promise])
  })

  it("uses the captured final address as the base for relative URLs", async () => {
    installFetch(happy)
    const result = await redesignWebsite(SITE)
    assert.equal(result.capture?.finalUrl, "https://www.joescafe.com/")
    assert.equal(result.capture?.text, "", "bulky page text is not kept")
  })

  it("accepts the real model output recorded from Sonnet 5", async () => {
    installFetch(({ path }) => (path === "/api/captures" ? CAPTURE_REPLY() : GENERATE_REPLY(FIXTURE, 1)))
    const result = await redesignWebsite(SITE)
    assert.deepEqual(pageOf(result.content), FIXTURE)
  })

  it("a generation that returns an earlier-format blueprint still works", async () => {
    installFetch(({ path }) =>
      path === "/api/captures"
        ? CAPTURE_REPLY()
        : {
            json: {
              ok: true,
              projectId: PROJECT,
              versionNumber: 1,
              blueprint: {
                schemaVersion: "1.0", siteId: "demo-site", slug: "x", businessName: "Joe's Café", description: "",
                theme: { primaryColor: "#112233", secondaryColor: "#F4F1EA", fontFamily: "Inter" },
                sections: [
                  { id: "a", type: "header", visible: true, content: {} },
                  { id: "b", type: "hero", visible: true, content: { headline: "Hi" } },
                  { id: "c", type: "footer", visible: true, content: {} },
                ],
              },
            },
          }
    )
    const result = await redesignWebsite(SITE)
    assert.equal(result.content.kind, "design")
  })
})

describe("malformed or unsupported generation output", () => {
  const cases: Array<[string, unknown]> = [
    ["a missing website", undefined],
    ["a website that is not an object", "<h1>hi</h1>"],
    ["an empty page", { html: "", css: "", javascript: "" }],
    ["a page with html of the wrong type", { html: ["<p>"], css: "", javascript: "" }],
    ["a page containing a script element", { html: "<p>a</p><script>fetch('/x')</script>", css: "", javascript: "" }],
    ["a page with an inline event handler", { html: '<p onmouseover="x()">a</p>', css: "", javascript: "" }],
    ["a page that tries to redirect", { html: '<meta http-equiv="refresh" content="0;url=https://evil.example">', css: "", javascript: "" }],
    ["a page with a stylesheet import", { html: "<p>a</p>", css: "@import url(//evil.example/x.css);", javascript: "" }],
    ["a page that is far too large", { html: "a".repeat(200_001), css: "", javascript: "" }],
  ]
  for (const [name, website] of cases) {
    it(`shows a helpful error for ${name}, and keeps the capture for a retry`, async () => {
      installFetch(({ path }) => (path === "/api/captures" ? CAPTURE_REPLY() : { json: { ok: true, projectId: PROJECT, versionNumber: 1, website } }))
      const error = await rejection(redesignWebsite(SITE))
      assert.equal(error.code, "invalid_response")
      assert.match(error.message, /couldn't read/i)
      assert.doesNotMatch(error.message, /script|onmouseover|refresh|import/i, "no technical detail for users")
      assert.ok(error.detail && error.detail.length > 0, "the reason is kept for developers")
      assert.equal(error.retryable, true)

      await rejection(redesignWebsite(SITE))
      assert.equal(calls.filter((c) => c.path === "/api/captures").length, 1, "retry reuses the capture")
    })
  }

  it("explains a model that produced a page failing the backend's checks", async () => {
    installFetch(({ path }) => (path === "/api/captures" ? CAPTURE_REPLY() : { status: 502, json: { error: "The AI-generated website did not pass validation." } }))
    const error = await rejection(redesignWebsite(SITE))
    assert.match(error.message, /safety checks/i)
    assert.equal(error.retryable, true)
  })

  it("explains a model that ran out of space", async () => {
    installFetch(({ path }) => (path === "/api/captures" ? CAPTURE_REPLY() : { status: 502, json: { error: "The AI ran out of space while writing the website. Please try again." } }))
    const error = await rejection(redesignWebsite(SITE))
    assert.match(error.message, /ran out of space/i)
  })

  it("never falls back to sample data", async () => {
    installFetch(({ path }) => (path === "/api/captures" ? CAPTURE_REPLY() : { status: 502, json: { error: "boom" } }))
    await rejection(redesignWebsite(SITE))
    assert.ok(!isMockMode())
  })
})

// ---------------------------------------------------------------------------
// Editing a page
// ---------------------------------------------------------------------------

describe("editing a generated page", () => {
  const content: SiteContent = { kind: "page", page: PAGE_V1 }
  const input = (extra: Partial<Parameters<typeof editWebsite>[0]> = {}) => ({
    projectId: PROJECT,
    prompt: "Change the main headline to Welcome to Our Cafe",
    content,
    versionNumber: 1,
    capture: capture(),
    ...extra,
  })

  it("sends only { projectId, baseVersion, prompt }: no page and no blueprint", async () => {
    installFetch(() => GENERATE_REPLY(PAGE_V2, 2))
    await editWebsite(input({ prompt: "  Make it warmer  " }))

    assert.equal(calls[0].url, `${API}/api/blueprints/edit`)
    assert.deepEqual(calls[0].body, { projectId: PROJECT, baseVersion: 1, prompt: "Make it warmer" })
  })

  it("returns exactly the page the backend returned, with its version", async () => {
    installFetch(() => GENERATE_REPLY(PAGE_V2, 2))
    const outcome = await editWebsite(input())

    assert.deepEqual(pageOf(outcome.content), PAGE_V2)
    assert.equal(outcome.versionNumber, 2)
    assert.equal(outcome.changed, true)
    assert.equal(outcome.summary, "Updated your website.")
  })

  it("preserves unrelated content and working interactions: the model's full page is what is shown", async () => {
    // The backend asks the model to return the COMPLETE page. The client applies
    // it as returned and never patches or merges, so nothing is dropped here.
    installFetch(() => GENERATE_REPLY(PAGE_V2, 2))
    const outcome = await editWebsite(input())
    const page = pageOf(outcome.content)
    assert.equal(page.css, PAGE_V1.css)
    assert.equal(page.javascript, PAGE_V1.javascript)
    assert.match(page.html, /id="toggle"/)
  })

  it("builds each edit on the version the previous edit produced", async () => {
    let version = 1
    installFetch(() => GENERATE_REPLY({ ...PAGE_V1, css: `body{margin:${version}px}` }, ++version))
    let current: { content: SiteContent; versionNumber: number } = { content, versionNumber: 1 }
    for (let i = 0; i < 3; i += 1) {
      const outcome = await editWebsite(input({ ...current }))
      current = { content: outcome.content, versionNumber: outcome.versionNumber! }
    }
    assert.deepEqual(calls.map((c) => c.body.baseVersion), [1, 2, 3])
    assert.equal(current.versionNumber, 4)
  })

  it("reports a page the AI returned unchanged as nothing changing, but still takes the new version", async () => {
    installFetch(() => GENERATE_REPLY(PAGE_V1, 2))
    const outcome = await editWebsite(input())
    assert.equal(outcome.changed, false)
    assert.match(outcome.summary, /same page/i)
    assert.equal(outcome.versionNumber, 2, "the backend saved version 2, so the next edit must be based on it")
  })

  it("a refused edit rejects, so nothing is applied", async () => {
    for (const reply of [
      { status: 502, json: { error: "The AI-generated website changes did not pass validation." } },
      { status: 502, json: { error: "anything" } },
      { status: 504, text: "" },
      { status: 500, text: "<html>" },
    ]) {
      installFetch(() => reply)
      const error = await rejection(editWebsite(input()))
      assert.ok(["server", "timeout"].includes(error.code), error.code)
    }
    installFetch(() => {
      throw new TypeError("fetch failed")
    })
    assert.equal((await rejection(editWebsite(input()))).code, "network")
  })

  it("rejects an edit answer that is not a valid page", async () => {
    for (const website of [undefined, null, "x", { html: "", css: "", javascript: "" }, { html: "<script>1</script>", css: "", javascript: "" }]) {
      installFetch(() => ({ json: { ok: true, projectId: PROJECT, versionNumber: 2, website } }))
      const error = await rejection(editWebsite(input()))
      assert.equal(error.code, "invalid_response", JSON.stringify(website))
    }
  })

  it("rejects an answer without a usable version number instead of guessing one", async () => {
    for (const versionNumber of [undefined, 0, -1, 1.5, "2", null]) {
      installFetch(() => ({ json: { ok: true, projectId: PROJECT, versionNumber, website: PAGE_V2 } }))
      const error = await rejection(editWebsite(input()))
      assert.equal(error.code, "invalid_response", String(versionNumber))
    }
  })

  it("rejects an earlier-format answer to a page edit", async () => {
    installFetch(() => ({ json: { ok: true, versionNumber: 2, blueprint: { nope: true } } }))
    assert.equal((await rejection(editWebsite(input()))).code, "invalid_response")
  })

  it("cannot edit without a version or with a bad project id, and sends nothing", async () => {
    installFetch(happy)
    for (const bad of [{ versionNumber: undefined }, { projectId: "../etc" }, { projectId: "" }]) {
      const error = await rejection(editWebsite(input(bad)))
      assert.equal(error.code, "not_found")
    }
    assert.equal(calls.length, 0)
  })

  it("checks the instruction before sending anything", async () => {
    installFetch(happy)
    for (const prompt of ["", "  ", "x".repeat(301)]) {
      assert.equal((await rejection(editWebsite(input({ prompt })))).code, "bad_request")
    }
    assert.equal(calls.length, 0)
  })
})

describe("stale versions (HTTP 409)", () => {
  const content: SiteContent = { kind: "page", page: PAGE_V1 }
  const conflict = { status: 409, json: { error: "This website is outdated. Load the latest version before editing.", latestVersion: 4 } }

  it("is a conflict with the newest version and a plain message, and applies nothing", async () => {
    installFetch(() => conflict)
    const error = await rejection(
      editWebsite({ projectId: PROJECT, prompt: "x", content, versionNumber: 2, capture: capture() })
    )
    assert.equal(error.code, "conflict")
    assert.equal(error.status, 409)
    assert.equal(error.latestVersion, 4)
    assert.match(error.message, /changed in another window/i)
    assert.match(error.message, /Load the latest version/i)
    assert.doesNotMatch(error.message, /outdated|baseVersion|latestVersion/)
    assert.equal(error.retryable, false, "repeating the same request cannot succeed")
  })

  it("ignores a nonsense latestVersion", async () => {
    for (const latestVersion of [0, -2, "4", null, 1.5]) {
      installFetch(() => ({ status: 409, json: { error: "x", latestVersion } }))
      const error = await rejection(editWebsite({ projectId: PROJECT, prompt: "x", content, versionNumber: 2 }))
      assert.equal(error.latestVersion, undefined, String(latestVersion))
    }
  })

  it("the newest version can then be loaded on request, as a page", async () => {
    installFetch(() => ({
      json: { ok: true, project: { projectId: PROJECT, latestVersion: 4 }, website: PAGE_V2 },
    }))
    const saved = await fetchLatestProject(PROJECT, capture())
    assert.equal(saved.versionNumber, 4)
    assert.deepEqual(pageOf(saved.content), PAGE_V2)
    assert.equal(calls[0].url, `${API}/api/projects/${PROJECT}`)
    assert.equal(calls[0].method, "GET")
  })

  it("a project that has no saved page yet cannot be loaded", async () => {
    installFetch(() => ({ json: { ok: true, project: { projectId: PROJECT, latestVersion: 0 }, website: null } }))
    assert.equal((await rejection(fetchLatestProject(PROJECT))).code, "invalid_response")
  })
})

describe("history of pages", () => {
  it("reads one saved version as a page", async () => {
    installFetch(() => ({ json: { ok: true, projectId: PROJECT, versionNumber: 1, version: {}, website: PAGE_V1 } }))
    const saved = await fetchVersion(PROJECT, 1, capture())
    assert.deepEqual(pageOf(saved.content), PAGE_V1)
    assert.equal(calls[0].url, `${API}/api/projects/${PROJECT}/versions/1`)
  })

  it("lists versions, including the design direction recorded on version 1", async () => {
    installFetch(() => ({
      json: {
        ok: true,
        projectId: PROJECT,
        versions: [
          { versionNumber: 2, changeType: "EDIT", prompt: "Make it warmer", createdAt: "2026-11-08T01:00:00.000Z" },
          { versionNumber: 1, changeType: "INITIAL", prompt: "Create a clean, modern café website", createdAt: "2026-11-08T00:00:00.000Z" },
        ],
      },
    }))
    const versions = await fetchVersionHistory(PROJECT)
    assert.deepEqual(versions.map((v) => [v.versionNumber, v.changeType, v.prompt]), [
      [2, "EDIT", "Make it warmer"],
      [1, "INITIAL", "Create a clean, modern café website"],
    ])
  })

  it("rejects a saved version whose page fails validation", async () => {
    installFetch(() => ({ json: { ok: true, versionNumber: 1, website: { html: "<script>1</script>", css: "", javascript: "" } } }))
    assert.equal((await rejection(fetchVersion(PROJECT, 1))).code, "invalid_response")
  })
})

// ---------------------------------------------------------------------------
// Earlier-format results still edit through the earlier request
// ---------------------------------------------------------------------------

describe("editing an earlier-format (blueprint) result against the current backend", () => {
  const blueprint: WebsiteBlueprint = {
    schemaVersion: "1.0", siteId: "demo-site", slug: "x", businessName: "Joe's Café", description: "",
    theme: { primaryColor: "#112233", secondaryColor: "#F4F1EA", fontFamily: "Inter" },
    sections: [
      { id: "header-main", type: "header", visible: true, content: {} },
      { id: "hero-main", type: "hero", visible: true, content: { headline: "Old" } },
      { id: "footer-main", type: "footer", visible: true, content: {} },
    ],
  }

  it("sends { blueprint, prompt } (stateless) and applies the returned blueprint", async () => {
    const edited = structuredClone(blueprint)
    edited.sections[1].content.headline = "New headline"
    installFetch(() => ({
      json: { ok: true, blueprint: edited, operations: [{ type: "set", sectionId: "hero-main", field: "headline", value: "New headline" }] },
    }))
    const first = normalizeResult({ blueprint })
    assert.ok(first.ok && first.content.kind === "design")
    const outcome = await editWebsite({ projectId: "legacy", prompt: "Change the headline", content: first.content })

    assert.deepEqual(Object.keys(calls[0].body).sort(), ["blueprint", "prompt"])
    assert.equal(outcome.content.kind, "design")
    if (outcome.content.kind === "design") assert.equal(outcome.content.design.hero.headline, "New headline")
    assert.equal(outcome.versionNumber, undefined, "a stateless edit has no saved version")
    assert.equal(outcome.summary, "Updated the hero headline.")
  })
})

describe("demo mode is unaffected", () => {
  it("makes no requests and cannot edit a generated page", async () => {
    setEnvironment({ mode: "mock" })
    installFetch(() => {
      throw new Error("demo mode must not call the network")
    })
    const result = await redesignWebsite(SITE, { instruction: "ignored in demo mode" })
    assert.equal(result.content.kind, "design")
    assert.equal(calls.length, 0)
    const error = await rejection(
      editWebsite({ projectId: "p", prompt: "x", content: { kind: "page", page: PAGE_V1 } })
    )
    assert.equal(error.code, "config")
  })
})
