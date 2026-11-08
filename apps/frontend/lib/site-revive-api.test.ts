import assert from "node:assert/strict"
import { afterEach, before, beforeEach, describe, it } from "node:test"

import { adaptBlueprint } from "@/lib/blueprint-adapter"
import { startRedesignJob } from "@/lib/redesign-job"
import {
  SiteReviveApiError,
  clearCaptureCache,
  describeApiError,
  editWebsite,
  fetchLatestProject,
  fetchVersion,
  fetchVersionHistory,
  isMockMode,
  isWebsiteDesign,
  redesignWebsite,
  type RedesignStage,
} from "@/lib/site-revive-api"
import type { WebsiteBlueprint, WebsiteCapture } from "@/types/backend"
import type { SiteContent } from "@/types/website"

/**
 * Tests the API client against a stubbed `fetch`. Nothing here touches a
 * network. Fixtures follow the shapes in packages/shared/src/index.ts.
 */

const API = "http://localhost:3001"
const SITE = "https://joescafe.com/"
const env = process.env as Record<string, string | undefined>

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setEnvironment(settings: { mode?: string; url?: string; screenshots?: string; nodeEnv?: string }) {
  const set = (key: string, value: string | undefined) => {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  set("NEXT_PUBLIC_SITE_REVIVE_API_MODE", settings.mode)
  set("NEXT_PUBLIC_SITE_REVIVE_API_URL", settings.url)
  set("NEXT_PUBLIC_SITE_REVIVE_SCREENSHOT_BASE_URL", settings.screenshots)
  if (settings.nodeEnv !== undefined) env.NODE_ENV = settings.nodeEnv
}

const setApiMode = () => setEnvironment({ mode: "api", url: API })

interface Call {
  path: string
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
      body: JSON.parse(String(init.body ?? "{}")),
      init,
    }
    calls.push(call)
    const reply = await handler(call)
    return new Response(reply.text ?? JSON.stringify(reply.json ?? {}), {
      status: reply.status ?? 200,
    })
  }) as typeof fetch
}

/** Rejects like a real fetch does when its signal aborts (also if it already has). */
function hangUntilAborted(init: RequestInit): Promise<never> {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"))
    if (init.signal?.aborted) abort()
    else init.signal?.addEventListener("abort", abort)
  })
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.ok(condition(), "condition was not met in time")
}

const WORKER_ID = "1bd89974-ee3d-4b89-b0f2-2138fad9724b"

function makeCapture(overrides: Partial<WebsiteCapture> = {}): WebsiteCapture {
  return {
    captureId: WORKER_ID,
    sourceUrl: SITE,
    finalUrl: SITE,
    capturedAt: "2026-11-07T10:00:00.000Z",
    title: "Home | Joe's Café",
    description: "Coffee since 2014.",
    headings: [{ level: 1, text: "Joe's Café" }],
    text: "Long page text that should not be kept.",
    links: [],
    images: [{ src: "https://joescafe.com/photos/front.jpg", alt: "The shop front" }],
    screenshots: {
      desktop: `http://localhost:3002/artifacts/${WORKER_ID}-desktop.png`,
      mobile: `http://localhost:3002/artifacts/${WORKER_ID}-mobile.png`,
    },
    ...overrides,
  }
}

function makeBlueprint(): WebsiteBlueprint {
  return {
    schemaVersion: "1.0",
    siteId: "demo-site",
    slug: "joes-cafe",
    businessName: "Joe's Café",
    description: "Coffee since 2014.",
    theme: { primaryColor: "#7A3E1D", secondaryColor: "#2F4A3A", fontFamily: "Lora" },
    sections: [
      { id: "header-main", type: "header", visible: true, content: { navigation: ["About", "Contact"] } },
      {
        id: "hero-main",
        type: "hero",
        visible: true,
        content: {
          eyebrow: "Welcome",
          headline: "Coffee, made slow",
          subheadline: "Roasted nearby.",
          primaryButtonText: "Find us",
          primaryButtonHref: "#contact",
          imageUrl: "",
        },
      },
      { id: "about-main", type: "about", visible: true, content: { heading: "Our story", body: "We opened in 2014." } },
      { id: "contact-main", type: "contact", visible: true, content: { phone: "(503) 555-0142" } },
      { id: "footer-main", type: "footer", visible: true, content: { copyright: "© 2026 Joe's Café." } },
    ],
  }
}

const CAPTURE_REPLY = (capture = makeCapture()): Reply => ({
  json: { ok: true, capture, sourceContent: '{"title":"Home | Joe\'s Café"}' },
})
const GENERATE_REPLY = (blueprint: unknown = makeBlueprint()): Reply => ({
  json: { ok: true, blueprint },
})

/** Standard happy-path backend. */
const happyBackend: Handler = ({ path }) =>
  path === "/api/captures" ? CAPTURE_REPLY() : GENERATE_REPLY()

/** A result's content, narrowed to the earlier "design" format (these tests use blueprints). */
function designOf(content: SiteContent): Extract<SiteContent, { kind: "design" }> {
  assert.equal(content.kind, "design")
  return content as Extract<SiteContent, { kind: "design" }>
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

const originalWarn = console.warn
before(() => {
  console.warn = () => {}
})
beforeEach(() => {
  clearCaptureCache()
})
afterEach(() => {
  globalThis.fetch = realFetch
  setEnvironment({ mode: undefined, url: undefined, screenshots: undefined, nodeEnv: "test" })
})
process.on("exit", () => {
  console.warn = originalWarn
})

// ---------------------------------------------------------------------------
// Mode and configuration
// ---------------------------------------------------------------------------

describe("mode and configuration", () => {
  it("defaults to api mode", () => {
    setEnvironment({})
    assert.equal(isMockMode(), false)
  })

  it("is in mock mode only when explicitly configured", () => {
    setEnvironment({ mode: "mock" })
    assert.equal(isMockMode(), true)
  })

  it("is in api mode when configured", () => {
    setApiMode()
    assert.equal(isMockMode(), false)
  })

  it("treats an unknown mode as an error, not as mock", async () => {
    setEnvironment({ mode: "typo", url: API })
    assert.equal(isMockMode(), false)
    installFetch(happyBackend)
    const error = await rejection(redesignWebsite(SITE))
    assert.equal(error.code, "config")
    assert.equal(calls.length, 0)
  })

  it("requires a valid backend URL in api mode", async () => {
    for (const url of [undefined, "", "   ", "not a url", "ftp://localhost:3001", "http://user:pass@localhost:3001"]) {
      setEnvironment({ mode: "api", url })
      installFetch(happyBackend)
      const error = await rejection(redesignWebsite(SITE))
      assert.equal(error.code, "config", String(url))
      assert.equal(calls.length, 0, String(url))
    }
  })

  it("requires https for a remote backend in production builds, but allows localhost", async () => {
    setEnvironment({ mode: "api", url: "http://api.example.com", nodeEnv: "production" })
    installFetch(happyBackend)
    assert.equal((await rejection(redesignWebsite(SITE))).code, "config")

    setEnvironment({ mode: "api", url: "https://api.example.com", nodeEnv: "production" })
    await redesignWebsite(SITE)
    assert.ok(calls[0].url.startsWith("https://api.example.com/"))

    clearCaptureCache()
    setEnvironment({ mode: "api", url: "http://localhost:3001", nodeEnv: "production" })
    await redesignWebsite(SITE)
  })

  it("rejects an invalid screenshot base URL", async () => {
    setEnvironment({ mode: "api", url: API, screenshots: "javascript:alert(1)" })
    installFetch(happyBackend)
    assert.equal((await rejection(redesignWebsite(SITE))).code, "config")
  })

  it("does not put a double slash in request URLs", async () => {
    setEnvironment({ mode: "api", url: `${API}/` })
    installFetch(happyBackend)
    await redesignWebsite(SITE)
    assert.deepEqual(
      calls.map((call) => call.url),
      [`${API}/api/captures`, `${API}/api/blueprints/generate`]
    )
  })
})

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

describe("mock mode", () => {
  beforeEach(() => {
    setEnvironment({ mode: "mock" })
    installFetch(() => {
      throw new Error("mock mode must not call the network")
    })
  })

  it("returns the sample redesign without any request", async () => {
    const result = await redesignWebsite(SITE)
    assert.equal(calls.length, 0)
    const content = designOf(result.content)
    assert.ok(isWebsiteDesign(content.design))
    assert.equal(content.blueprint, undefined)
    assert.equal(result.capture, undefined)
  })

  it("still edits locally without any request", async () => {
    const { content } = await redesignWebsite(SITE)
    const outcome = await editWebsite({
      projectId: "p",
      prompt: "Change the hero title to Welcome to Our Cafe",
      content,
    })
    assert.equal(calls.length, 0)
    assert.equal(designOf(outcome.content).design.hero.headline, "Welcome to Our Cafe")
    assert.equal(outcome.changed, true)
    assert.equal(designOf(outcome.content).blueprint, undefined)
  })

  it("rejects an instruction the sample editor does not know", async () => {
    const { content } = await redesignWebsite(SITE)
    const error = await rejection(editWebsite({ projectId: "p", prompt: "Make it pop", content }))
    assert.equal(error.code, "rejected")
  })
})

// ---------------------------------------------------------------------------
// Redesign: the two-call flow
// ---------------------------------------------------------------------------

describe("redesignWebsite (api mode)", () => {
  beforeEach(setApiMode)

  it("captures the website, then generates a blueprint from the captured content", async () => {
    installFetch(happyBackend)
    await redesignWebsite(SITE)

    assert.deepEqual(
      calls.map((call) => [call.init.method, call.path]),
      [
        ["POST", "/api/captures"],
        ["POST", "/api/blueprints/generate"],
      ]
    )
    assert.deepEqual(calls[0].body, { sourceUrl: SITE })
    assert.deepEqual(calls[1].body, {
      businessName: "Joe's Café",
      description: "Coffee since 2014.",
      sourceUrl: SITE,
      sourceContent: '{"title":"Home | Joe\'s Café"}',
    })
  })

  it("sends JSON with no credentials", async () => {
    installFetch(happyBackend)
    await redesignWebsite(SITE)
    for (const call of calls) {
      assert.equal(call.init.credentials, "omit")
      const headers = call.init.headers as Record<string, string>
      assert.equal(headers["Content-Type"], "application/json")
      assert.equal(headers.Authorization, undefined)
    }
  })

  it("omits optional generate fields the capture did not provide", async () => {
    installFetch(({ path }) =>
      path === "/api/captures"
        ? {
            json: {
              ok: true,
              capture: makeCapture({
                description: "",
                title: "",
                sourceUrl: "https://www.sunrise-bakery.co.uk/",
                finalUrl: "https://www.sunrise-bakery.co.uk/",
              }),
            },
          }
        : GENERATE_REPLY()
    )
    await redesignWebsite("https://www.sunrise-bakery.co.uk/")
    assert.deepEqual(calls[1].body, {
      businessName: "Sunrise Bakery",
      sourceUrl: "https://www.sunrise-bakery.co.uk/",
    })
  })

  it("returns the design, blueprint and a compact capture", async () => {
    installFetch(happyBackend)
    const result = await redesignWebsite(SITE)

    assert.equal(result.projectId, WORKER_ID)
    assert.equal(result.originalScreenshotUrl, makeCapture().screenshots.desktop)
    const content = designOf(result.content)
    assert.ok(isWebsiteDesign(content.design))
    assert.equal(content.design.businessName, "Joe's Café")
    assert.equal(content.design.hero.headline, "Coffee, made slow")
    assert.deepEqual(content.blueprint, makeBlueprint())
    // The capture is kept for rebuilding the design, minus the bulky page text.
    assert.equal(result.capture?.captureId, WORKER_ID)
    assert.equal(result.capture?.text, "")
    assert.deepEqual(result.capture?.headings, [])
    assert.equal(result.capture?.images.length, 1)
    // The hero image came from the captured page through the adapter.
    assert.equal(content.design.hero.image.src, "https://joescafe.com/photos/front.jpg")
  })

  it("returns exactly what the adapter makes from the same data", async () => {
    installFetch(happyBackend)
    const result = await redesignWebsite(SITE)
    const adapted = adaptBlueprint(makeBlueprint(), makeCapture())
    assert.ok(adapted.ok)
    assert.deepEqual(designOf(result.content).design, adapted.value.design)
  })

  it("reports the stages in order", async () => {
    installFetch(happyBackend)
    const stages: RedesignStage[] = []
    await redesignWebsite(SITE, { onStage: (stage) => stages.push(stage) })
    assert.deepEqual(stages, ["capturing", "designing"])
  })

  describe("screenshot URL", () => {
    const relativeCapture = () =>
      makeCapture({ screenshots: { desktop: `/artifacts/${WORKER_ID}-desktop.png`, mobile: "" } })
    const backend: Handler = ({ path }) =>
      path === "/api/captures" ? CAPTURE_REPLY(relativeCapture()) : GENERATE_REPLY()

    it("resolves a path against the screenshot base URL", async () => {
      setEnvironment({ mode: "api", url: API, screenshots: "http://localhost:3002/" })
      installFetch(backend)
      const result = await redesignWebsite(SITE)
      assert.equal(result.originalScreenshotUrl, `http://localhost:3002/artifacts/${WORKER_ID}-desktop.png`)
    })

    it("is empty, not wrong, when a path cannot be resolved", async () => {
      installFetch(backend)
      const result = await redesignWebsite(SITE)
      assert.equal(result.originalScreenshotUrl, "")
      assert.ok(isWebsiteDesign(designOf(result.content).design))
    })

    it("never uses a non-http(s) screenshot", async () => {
      installFetch(({ path }) =>
        path === "/api/captures"
          ? CAPTURE_REPLY(makeCapture({ screenshots: { desktop: "javascript:alert(1)", mobile: "" } }))
          : GENERATE_REPLY()
      )
      assert.equal((await redesignWebsite(SITE)).originalScreenshotUrl, "")
    })
  })
})

// ---------------------------------------------------------------------------
// Redesign: failures never become mock results
// ---------------------------------------------------------------------------

describe("redesignWebsite failures (api mode)", () => {
  beforeEach(setApiMode)

  const failingAt =
    (failPath: string, reply: Reply): Handler =>
    ({ path }) =>
      path === failPath ? reply : path === "/api/captures" ? CAPTURE_REPLY() : GENERATE_REPLY()

  it("rejects instead of returning sample data when the backend is down", async () => {
    installFetch(() => {
      throw new TypeError("fetch failed")
    })
    const error = await rejection(redesignWebsite(SITE))
    assert.equal(error.code, "network")
    assert.equal(error.retryable, true)
    assert.match(error.message, /couldn't reach/i)
  })

  it("rejects instead of returning sample data on a server error at every step", async () => {
    for (const failPath of ["/api/captures", "/api/blueprints/generate"]) {
      clearCaptureCache()
      installFetch(failingAt(failPath, { status: 500, json: { error: "boom" } }))
      const error = await rejection(redesignWebsite(SITE))
      assert.equal(error.code, "server", failPath)
      assert.equal(error.status, 500)
    }
  })

  describe("capture errors", () => {
    it("shows the worker's own message for a rejected website address", async () => {
      installFetch(failingAt("/api/captures", {
        status: 400,
        json: { error: "Local and internal network addresses cannot be captured." },
      }))
      const error = await rejection(redesignWebsite(SITE))
      assert.equal(error.code, "bad_request")
      assert.equal(error.message, "Local and internal network addresses cannot be captured.")
      assert.equal(calls.length, 1, "no AI call after a failed capture")
    })

    it("does not show schema error text", async () => {
      installFetch(failingAt("/api/captures", {
        status: 400,
        json: { error: "Invalid capture request", details: [{ path: ["sourceUrl"] }] },
      }))
      const error = await rejection(redesignWebsite(SITE))
      assert.match(error.message, /not accepted/i)
      assert.doesNotMatch(error.message, /Invalid capture request/)
    })

    it("shows an HTTP status failure of the website", async () => {
      installFetch(failingAt("/api/captures", {
        status: 502,
        json: { error: "The website responded with HTTP 403." },
      }))
      assert.equal((await rejection(redesignWebsite(SITE))).message, "The website responded with HTTP 403.")
    })

    it("hides internal error text behind a plain message but keeps it as detail", async () => {
      const internal = "page.goto: net::ERR_CONNECTION_REFUSED at https://joescafe.com/ Call log: - navigating"
      installFetch(failingAt("/api/captures", { status: 502, json: { error: internal } }))
      const error = await rejection(redesignWebsite(SITE))
      assert.match(error.message, /couldn't capture that website/i)
      assert.doesNotMatch(error.message, /page\.goto|ERR_/)
      assert.equal(error.detail, internal.slice(0, 300))
      assert.equal(error.retryable, true)
    })

    it("explains a timeout from the backend", async () => {
      installFetch(failingAt("/api/captures", { status: 504, json: { error: "The operation was aborted due to timeout" } }))
      const error = await rejection(redesignWebsite(SITE))
      assert.equal(error.code, "timeout")
      assert.match(error.message, /took too long to load/i)
    })
  })

  describe("generate errors", () => {
    it("hides AWS error text", async () => {
      const aws = "The security token included in the request is expired"
      installFetch(failingAt("/api/blueprints/generate", { status: 502, json: { error: aws } }))
      const error = await rejection(redesignWebsite(SITE))
      assert.equal(error.code, "server")
      assert.match(error.message, /AI couldn't create a design/i)
      assert.doesNotMatch(error.message, /token|expired/i)
      assert.equal(error.detail, aws)
    })

    it("explains a timeout from the backend", async () => {
      installFetch(failingAt("/api/blueprints/generate", { status: 504, text: "" }))
      const error = await rejection(redesignWebsite(SITE))
      assert.equal(error.code, "timeout")
      assert.match(error.message, /AI took too long/i)
    })

    it("treats a 400 as a problem on our side and shows nothing technical", async () => {
      installFetch(failingAt("/api/blueprints/generate", { status: 400, json: { error: "Invalid request" } }))
      const error = await rejection(redesignWebsite(SITE))
      assert.equal(error.code, "bad_request")
      assert.doesNotMatch(error.message, /Invalid request/)
    })
  })

  it("maps rate limits, refusals and missing routes", async () => {
    const expectations: Array<[number, string]> = [
      [429, "rate_limited"],
      [403, "server"],
      [401, "server"],
      [404, "not_found"],
      [503, "server"],
    ]
    for (const [status, code] of expectations) {
      clearCaptureCache()
      installFetch(failingAt("/api/captures", { status, text: "<html>gateway</html>" }))
      const error = await rejection(redesignWebsite(SITE))
      assert.equal(error.code, code, String(status))
      assert.equal(error.status, status)
    }
  })

  describe("unreadable responses", () => {
    it("rejects a 200 that is not JSON", async () => {
      installFetch(() => ({ text: "<html>not json</html>" }))
      assert.equal((await rejection(redesignWebsite(SITE))).code, "invalid_response")
    })

    it("rejects a capture response without a usable capture", async () => {
      for (const body of [{}, { capture: null }, { capture: { captureId: "x" } }, { ok: true, capture: [] }]) {
        clearCaptureCache()
        installFetch(() => ({ json: body }))
        assert.equal((await rejection(redesignWebsite(SITE))).code, "invalid_response", JSON.stringify(body))
        assert.equal(calls.length, 1)
      }
    })

    it("rejects a blueprint that does not pass validation", async () => {
      const broken = { ...makeBlueprint(), sections: [] }
      for (const blueprint of [undefined, null, "text", broken, { ...makeBlueprint(), schemaVersion: "2.0" }]) {
        clearCaptureCache()
        installFetch(({ path }) => (path === "/api/captures" ? CAPTURE_REPLY() : { json: { ok: true, blueprint } }))
        const error = await rejection(redesignWebsite(SITE))
        assert.equal(error.code, "invalid_response")
        assert.match(error.message, /couldn't read/i)
      }
    })

    it("accepts a response without sourceContent", async () => {
      installFetch(({ path }) =>
        path === "/api/captures" ? { json: { ok: true, capture: makeCapture() } } : GENERATE_REPLY()
      )
      await redesignWebsite(SITE)
      assert.equal("sourceContent" in calls[1].body, false)
    })
  })

  describe("timeouts and cancelling", () => {
    it("times out a request that never answers", async () => {
      installFetch(({ init }) => hangUntilAborted(init))
      const error = await rejection(redesignWebsite(SITE, { timeoutMs: 20 }))
      assert.equal(error.code, "timeout")
      assert.equal(error.retryable, true)
    })

    it("stops when cancelled and sends nothing more", async () => {
      const controller = new AbortController()
      installFetch(({ init }) => hangUntilAborted(init))
      const pending = rejection(redesignWebsite(SITE, { signal: controller.signal }))
      await until(() => calls.length === 1)
      controller.abort()
      assert.equal((await pending).code, "aborted")
      assert.equal(calls.length, 1)
    })

    it("does not start when already cancelled, and sends nothing", async () => {
      const controller = new AbortController()
      controller.abort()
      installFetch(({ init }) => hangUntilAborted(init))
      assert.equal((await rejection(redesignWebsite(SITE, { signal: controller.signal }))).code, "aborted")
      assert.equal(calls.length, 0)
    })
  })

  describe("retry after the AI step fails", () => {
    it("reuses the capture instead of visiting the website again", async () => {
      let failGenerate = true
      installFetch(({ path }) => {
        if (path === "/api/captures") return CAPTURE_REPLY()
        return failGenerate ? { status: 502, json: { error: "Throttled" } } : GENERATE_REPLY()
      })

      await rejection(redesignWebsite(SITE))
      failGenerate = false
      const stages: RedesignStage[] = []
      const result = await redesignWebsite(SITE, { onStage: (stage) => stages.push(stage) })

      assert.deepEqual(calls.map((call) => call.path), [
        "/api/captures",
        "/api/blueprints/generate",
        "/api/blueprints/generate",
      ])
      assert.deepEqual(stages, ["designing"])
      assert.equal(result.projectId, WORKER_ID)
    })

    it("captures again once a redesign has succeeded", async () => {
      installFetch(happyBackend)
      await redesignWebsite(SITE)
      await redesignWebsite(SITE)
      assert.deepEqual(calls.map((call) => call.path), [
        "/api/captures",
        "/api/blueprints/generate",
        "/api/captures",
        "/api/blueprints/generate",
      ])
    })

    it("does not reuse a capture for a different website", async () => {
      installFetch(({ path }) => (path === "/api/captures" ? CAPTURE_REPLY() : { status: 502, json: {} }))
      await rejection(redesignWebsite(SITE))
      await rejection(redesignWebsite("https://other.example/"))
      assert.equal(calls.filter((call) => call.path === "/api/captures").length, 2)
    })
  })
})

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

describe("editWebsite (api mode)", () => {
  beforeEach(setApiMode)

  async function project() {
    installFetch(happyBackend)
    const result = await redesignWebsite(SITE)
    calls = []
    const content = designOf(result.content)
    assert.ok(content.blueprint)
    return { result, blueprint: content.blueprint, design: content.design }
  }

  /** The input an edit of an earlier-format result takes. */
  const legacyInput = (
    base: { result: { projectId: string; capture?: WebsiteCapture }; blueprint: WebsiteBlueprint; design: Extract<SiteContent, { kind: "design" }>["design"] },
    prompt: string,
    extra: { versionNumber?: number } = {}
  ) => ({
    projectId: base.result.projectId,
    prompt,
    content: { kind: "design" as const, design: base.design, blueprint: base.blueprint },
    capture: base.result.capture,
    ...extra,
  })

  function editedBlueprint(blueprint: WebsiteBlueprint, content: Record<string, unknown>): WebsiteBlueprint {
    const copy = structuredClone(blueprint)
    Object.assign(copy.sections.find((section) => section.id === "hero-main")!.content, content)
    return copy
  }

  const operation = (field: string, value: unknown) => ({
    type: "set",
    sectionId: "hero-main",
    field,
    value,
  })

  it("sends the stored blueprint and the instruction to the edit endpoint", async () => {
    const base = await project()
    const { blueprint } = base
    installFetch(() => ({ json: { ok: true, blueprint, operations: [operation("headline", "x")] } }))

    await editWebsite(legacyInput(base, "  Change the hero headline to Hello  "))

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `${API}/api/blueprints/edit`)
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["blueprint", "prompt"])
    assert.equal(calls[0].body.prompt, "Change the hero headline to Hello")
    assert.deepEqual(calls[0].body.blueprint, blueprint)
  })

  it("returns the converted design, the new blueprint and a summary", async () => {
    const base = await project()
    const { blueprint } = base
    const updated = editedBlueprint(blueprint, { headline: "Welcome to Our Cafe", primaryButtonText: "Contact Us" })
    installFetch(() => ({
      json: {
        ok: true,
        blueprint: updated,
        operations: [operation("headline", "Welcome to Our Cafe"), operation("primaryButtonText", "Contact Us")],
      },
    }))

    const outcome = await editWebsite(legacyInput(base, "Change the headline"))
    const edited = designOf(outcome.content)

    assert.equal(outcome.changed, true)
    assert.equal(edited.design.hero.headline, "Welcome to Our Cafe")
    assert.equal(edited.design.hero.primaryCta.label, "Contact Us")
    assert.deepEqual(edited.blueprint, updated)
    assert.equal(outcome.summary, "Updated the hero headline, hero primary button text.")
    // The original is untouched, so a later edit can build on `outcome.blueprint`.
    assert.equal(blueprint.sections[1].content.headline, "Coffee, made slow")
    // Rebuilt with the capture, so the original site's photo is still the hero image.
    assert.equal(edited.design.hero.image.src, "https://joescafe.com/photos/front.jpg")
  })

  it("keeps the AI's new values out of the summary", async () => {
    const base = await project()
    const { blueprint } = base
    installFetch(() => ({
      json: {
        ok: true,
        blueprint: editedBlueprint(blueprint, { headline: "<script>alert(1)</script>" }),
        operations: [operation("headline", "<script>alert(1)</script>"), { sectionId: 5 }, null, "x"],
      },
    }))
    const outcome = await editWebsite(legacyInput(base, "x"))
    assert.equal(outcome.summary, "Updated the hero headline.")
  })

  it("says so when the backend only changed things the preview does not show", async () => {
    const base = await project()
    const { blueprint } = base
    // `eyebrow` is part of the blueprint but is not drawn.
    installFetch(() => ({
      json: { ok: true, blueprint: editedBlueprint(blueprint, { eyebrow: "New eyebrow" }), operations: [operation("eyebrow", "New eyebrow")] },
    }))
    const outcome = await editWebsite(legacyInput(base, "Change the eyebrow"))
    assert.equal(outcome.changed, false)
    assert.match(outcome.summary, /nothing looks different/i)
    // The new blueprint is still returned so the next edit builds on it.
    assert.equal(designOf(outcome.content).blueprint?.sections[1].content.eyebrow, "New eyebrow")
  })

  it("falls back to a general summary when operations are missing", async () => {
    const base = await project()
    installFetch(() => ({ json: { ok: true, blueprint: editedBlueprint(base.blueprint, { headline: "New" }) } }))
    const outcome = await editWebsite(legacyInput(base, "x"))
    assert.equal(outcome.summary, "Updated the design.")
  })

  it("cannot edit a project that has no stored blueprint, and sends nothing", async () => {
    const base = await project()
    installFetch(happyBackend)
    const error = await rejection(
      editWebsite({
        projectId: "p",
        prompt: "Change the headline",
        content: { kind: "design", design: base.design },
      })
    )
    assert.equal(error.code, "not_found")
    assert.equal(calls.length, 0)
  })

  it("checks the instruction before sending anything", async () => {
    const base = await project()
    installFetch(happyBackend)
    for (const prompt of ["", "   ", "x".repeat(301)]) {
      const error = await rejection(editWebsite(legacyInput(base, prompt)))
      assert.equal(error.code, "bad_request")
    }
    assert.equal(calls.length, 0)
  })

  it("rejects instead of changing anything when the backend fails", async () => {
    const project_ = await project()
    const base = legacyInput(project_, "Change the headline")

    installFetch(() => ({ status: 502, json: { error: "The AI returned invalid editing operations." } }))
    let error = await rejection(editWebsite(base))
    assert.equal(error.code, "server")
    assert.match(error.message, /couldn't apply that change/i)
    assert.equal(error.retryable, true)

    installFetch(() => ({ status: 400, json: { error: "Invalid edit request" } }))
    error = await rejection(editWebsite(base))
    assert.equal(error.code, "bad_request")
    assert.doesNotMatch(error.message, /Invalid edit request/)

    installFetch(() => {
      throw new TypeError("fetch failed")
    })
    assert.equal((await rejection(editWebsite(base))).code, "network")

    installFetch(() => ({ json: { ok: true, blueprint: { nope: true } } }))
    assert.equal((await rejection(editWebsite(base))).code, "invalid_response")
  })

  it("times out an edit that never answers", async () => {
    const base = await project()
    installFetch(({ init }) => hangUntilAborted(init))
    const error = await rejection(editWebsite(legacyInput(base, "x"), { timeoutMs: 20 }))
    assert.equal(error.code, "timeout")
  })
})

// ---------------------------------------------------------------------------
// Progress reported to the processing screen
// ---------------------------------------------------------------------------

describe("redesign job progress (api mode)", () => {
  beforeEach(setApiMode)

  it("moves from the capture stages to the design stage when the AI request starts", async () => {
    const captureGate = deferred()
    const generateGate = deferred()
    installFetch(async ({ path }) => {
      if (path === "/api/captures") {
        await captureGate.promise
        return CAPTURE_REPLY()
      }
      await generateGate.promise
      return GENERATE_REPLY()
    })

    const job = startRedesignJob("https://progress.example/")
    await until(() => calls.length === 1)
    assert.ok(job.stageIndex() <= 1, "capturing shows at most the second stage")

    captureGate.resolve()
    await until(() => calls.length === 2)
    assert.equal(job.stageIndex(), 2)

    generateGate.resolve()
    const result = await job.promise
    assert.equal(result.projectId, WORKER_ID)
  })

  it("rejects like the client does and never falls back to the sample", async () => {
    installFetch(() => ({ status: 500, json: { error: "boom" } }))
    const error = await rejection(startRedesignJob("https://failing.example/").promise)
    assert.equal(error.code, "server")
  })
})

// ---------------------------------------------------------------------------

describe("describeApiError", () => {
  it("shows API error messages and hides everything else", () => {
    assert.equal(describeApiError(new SiteReviveApiError("server", "Plain message."), "fallback"), "Plain message.")
    assert.equal(describeApiError(new Error("secret internals"), "fallback"), "fallback")
    assert.equal(describeApiError("text", "fallback"), "fallback")
  })

  it("never puts the technical detail in the message", () => {
    const error = new SiteReviveApiError("server", "Friendly.", { detail: "ExpiredTokenException" })
    assert.equal(describeApiError(error, "fallback"), "Friendly.")
  })
})

// ---------------------------------------------------------------------------
// Projects and versions (the backend keeps one project per redesign)
// ---------------------------------------------------------------------------

const PROJECT = "69112fc8-f065-40e3-a706-99a23e69a8ad"

const PROJECT_CAPTURE_REPLY = (): Reply => ({
  json: { ok: true, projectId: PROJECT, capture: makeCapture(), sourceContent: '{"title":"x"}' },
})
const SAVED_GENERATE_REPLY = (versionNumber = 1): Reply => ({
  json: { ok: true, projectId: PROJECT, versionNumber, blueprint: makeBlueprint() },
})

describe("one redesign, one project (api mode)", () => {
  beforeEach(setApiMode)

  it("generates under the project the capture created and keeps its id and version", async () => {
    installFetch(({ path }) => (path === "/api/captures" ? PROJECT_CAPTURE_REPLY() : SAVED_GENERATE_REPLY()))
    const result = await redesignWebsite(SITE)

    assert.equal(calls[1].body.projectId, PROJECT)
    assert.equal(result.projectId, PROJECT)
    assert.equal(result.versionNumber, 1)
    assert.equal(calls.filter((call) => call.path === "/api/captures").length, 1)
  })

  it("still works with a backend that returns no project id", async () => {
    installFetch(happyBackend)
    const result = await redesignWebsite(SITE)
    assert.equal("projectId" in calls[1].body, false)
    assert.equal(result.projectId, WORKER_ID)
    assert.equal(result.versionNumber, undefined)
  })

  it("ignores a project id that is not a UUID", async () => {
    installFetch(({ path }) =>
      path === "/api/captures"
        ? { json: { ok: true, projectId: "../../etc/passwd", capture: makeCapture() } }
        : { json: { ok: true, projectId: "nope", versionNumber: 0, blueprint: makeBlueprint() } }
    )
    const result = await redesignWebsite(SITE)
    assert.equal("projectId" in calls[1].body, false)
    assert.equal(result.projectId, WORKER_ID)
    assert.equal(result.versionNumber, undefined)
  })

  it("retries the AI step under the same project instead of creating another", async () => {
    let fail = true
    installFetch(({ path }) =>
      path === "/api/captures"
        ? PROJECT_CAPTURE_REPLY()
        : fail ? { status: 502, json: { error: "Throttled" } } : SAVED_GENERATE_REPLY()
    )
    await rejection(redesignWebsite(SITE))
    fail = false
    const result = await redesignWebsite(SITE)

    assert.equal(calls.filter((call) => call.path === "/api/captures").length, 1, "one capture, so one project")
    assert.deepEqual(
      calls.filter((call) => call.path.endsWith("/generate")).map((call) => call.body.projectId),
      [PROJECT, PROJECT]
    )
    assert.equal(result.projectId, PROJECT)
  })

  it("starts over with a fresh capture when the backend says the project is already generated", async () => {
    installFetch(({ path }) =>
      path === "/api/captures"
        ? PROJECT_CAPTURE_REPLY()
        : { status: 409, json: { error: "This project already has a generated Blueprint.", latestVersion: 1 } }
    )
    const error = await rejection(redesignWebsite(SITE))
    assert.equal(error.code, "conflict")
    assert.equal(error.retryable, true)

    await rejection(redesignWebsite(SITE))
    assert.equal(calls.filter((call) => call.path === "/api/captures").length, 2, "a fresh capture and project")
  })
})

describe("earlier-format backend: versioned blueprint edits (compatibility)", () => {
  beforeEach(setApiMode)

  async function savedProject() {
    installFetch(({ path }) => (path === "/api/captures" ? PROJECT_CAPTURE_REPLY() : SAVED_GENERATE_REPLY()))
    const result = await redesignWebsite(SITE)
    calls = []
    const content = designOf(result.content)
    assert.ok(content.blueprint && result.versionNumber)
    return { result, blueprint: content.blueprint, design: content.design, versionNumber: result.versionNumber }
  }

  const editedBlueprint = (blueprint: WebsiteBlueprint, headline: string) => {
    const copy = structuredClone(blueprint)
    copy.sections.find((section) => section.id === "hero-main")!.content.headline = headline
    return copy
  }

  const inputFor = (
    state: { blueprint: WebsiteBlueprint; design: Extract<SiteContent, { kind: "design" }>["design"] },
    extra: { versionNumber?: number; capture?: WebsiteCapture } = {}
  ) => ({
    projectId: PROJECT,
    prompt: "Change the headline",
    content: { kind: "design" as const, design: state.design, blueprint: state.blueprint },
    ...extra,
  })

  it("sends the project and the version the edit is based on", async () => {
    const saved = await savedProject()
    installFetch(() => ({
      json: { ok: true, projectId: PROJECT, versionNumber: 2, blueprint: editedBlueprint(saved.blueprint, "New"), operations: [] },
    }))
    const outcome = await editWebsite(inputFor(saved, { versionNumber: saved.versionNumber, capture: saved.result.capture }))

    assert.equal(calls[0].body.projectId, PROJECT)
    assert.equal(calls[0].body.baseVersion, 1)
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["baseVersion", "blueprint", "projectId", "prompt"])
    assert.equal(outcome.versionNumber, 2)
    assert.equal(designOf(outcome.content).design.hero.headline, "New")
  })

  it("builds each edit on the version the previous edit produced", async () => {
    const saved = await savedProject()
    let version = 1
    installFetch(() => {
      version += 1
      return { json: { ok: true, projectId: PROJECT, versionNumber: version, blueprint: editedBlueprint(saved.blueprint, `v${version}`), operations: [] } }
    })
    let current = { design: saved.design, blueprint: saved.blueprint, versionNumber: 1 }
    for (let i = 0; i < 3; i += 1) {
      const outcome = await editWebsite(inputFor(current, { versionNumber: current.versionNumber, capture: saved.result.capture }))
      const next = designOf(outcome.content)
      current = { design: next.design, blueprint: next.blueprint!, versionNumber: outcome.versionNumber! }
    }
    assert.deepEqual(calls.map((call) => call.body.baseVersion), [1, 2, 3])
    assert.equal(current.versionNumber, 4)
  })

  it("stays stateless (no project, no version) when the version is unknown", async () => {
    const saved = await savedProject()
    installFetch(() => ({ json: { ok: true, blueprint: editedBlueprint(saved.blueprint, "New"), operations: [] } }))
    const outcome = await editWebsite(inputFor(saved, { capture: saved.result.capture }))
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["blueprint", "prompt"])
    assert.equal(outcome.versionNumber, undefined)
  })

  it("never trusts a version number the backend did not send for a versioned edit", async () => {
    const saved = await savedProject()
    installFetch(() => ({ json: { ok: true, versionNumber: -3, blueprint: editedBlueprint(saved.blueprint, "New"), operations: [] } }))
    const outcome = await editWebsite(inputFor(saved, { versionNumber: saved.versionNumber, capture: saved.result.capture }))
    assert.equal(outcome.versionNumber, undefined)
  })

  it("reports an edit made on an outdated version as a conflict, with the newest version", async () => {
    const saved = await savedProject()
    installFetch(() => ({
      status: 409,
      json: { error: "This Blueprint is outdated. Load the latest version before editing.", latestVersion: 4 },
    }))
    const error = await rejection(editWebsite(inputFor(saved, { versionNumber: saved.versionNumber })))
    assert.equal(error.code, "conflict")
    assert.equal(error.latestVersion, 4)
    assert.equal(error.status, 409)
    assert.match(error.message, /changed in another window/i)
    assert.doesNotMatch(error.message, /Blueprint/)
  })

  it("explains a project that no longer exists", async () => {
    const saved = await savedProject()
    installFetch(() => ({ status: 404, json: { error: "Project not found." } }))
    const error = await rejection(editWebsite(inputFor(saved, { versionNumber: saved.versionNumber })))
    assert.equal(error.code, "not_found")
    assert.match(error.message, /no longer available/i)
  })
})

describe("saved versions: reading (api mode)", () => {
  beforeEach(setApiMode)

  const history = {
    ok: true,
    projectId: PROJECT,
    versions: [
      { versionId: "v000001", versionNumber: 1, changeType: "INITIAL", createdAt: "2026-11-08T00:00:00.000Z" },
      { versionId: "v000003", versionNumber: 3, changeType: "EDIT", prompt: "  Change   the headline\n to Hi  ", createdAt: "2026-11-08T00:02:00.000Z" },
      { versionId: "v000002", versionNumber: 2, changeType: "EDIT", prompt: "Shorter about", createdAt: "2026-11-08T00:01:00.000Z" },
      { versionNumber: "bad" },
      null,
    ],
  }

  it("lists the versions newest first, skipping malformed entries and tidying prompts", async () => {
    installFetch(() => ({ json: history }))
    const versions = await fetchVersionHistory(PROJECT)

    assert.equal(calls[0].url, `${API}/api/projects/${PROJECT}/versions`)
    assert.equal(calls[0].init.method, "GET")
    assert.equal(calls[0].init.body, undefined)
    assert.deepEqual(versions.map((v) => [v.versionNumber, v.changeType]), [[3, "EDIT"], [2, "EDIT"], [1, "INITIAL"]])
    assert.equal(versions[0].prompt, "Change the headline to Hi")
    assert.equal(versions[2].prompt, undefined)
  })

  it("loads one version and converts it with the stored capture", async () => {
    installFetch(() => ({ json: { ok: true, projectId: PROJECT, versionNumber: 1, blueprint: makeBlueprint() } }))
    const saved = await fetchVersion(PROJECT, 1, makeCapture())
    assert.equal(calls[0].url, `${API}/api/projects/${PROJECT}/versions/1`)
    assert.equal(saved.versionNumber, 1)
    assert.ok(isWebsiteDesign(designOf(saved.content).design))
    assert.equal(designOf(saved.content).design.hero.image.src, "https://joescafe.com/photos/front.jpg")
  })

  it("loads the latest state of a project", async () => {
    installFetch(() => ({
      json: { ok: true, project: { projectId: PROJECT, latestVersion: 5 }, blueprint: makeBlueprint() },
    }))
    const saved = await fetchLatestProject(PROJECT, makeCapture())
    assert.equal(calls[0].url, `${API}/api/projects/${PROJECT}`)
    assert.equal(saved.versionNumber, 5)
    assert.ok(isWebsiteDesign(designOf(saved.content).design))
  })

  it("rejects unreadable answers", async () => {
    installFetch(() => ({ json: { ok: true, project: { latestVersion: 0 }, blueprint: makeBlueprint() } }))
    assert.equal((await rejection(fetchLatestProject(PROJECT))).code, "invalid_response")
    installFetch(() => ({ json: { ok: true, project: { latestVersion: 2 }, blueprint: null } }))
    assert.equal((await rejection(fetchLatestProject(PROJECT))).code, "invalid_response")
    installFetch(() => ({ json: { ok: true } }))
    assert.equal((await rejection(fetchVersionHistory(PROJECT))).code, "invalid_response")
    installFetch(() => ({ json: { ok: true, blueprint: { nope: 1 } } }))
    assert.equal((await rejection(fetchVersion(PROJECT, 1))).code, "invalid_response")
  })

  it("maps backend failures to plain messages", async () => {
    installFetch(() => ({ status: 404, json: { error: "Project not found." } }))
    const gone = await rejection(fetchVersionHistory(PROJECT))
    assert.equal(gone.code, "not_found")
    assert.match(gone.message, /no longer available/i)

    installFetch(() => ({ status: 500, json: { error: "Unable to retrieve version history." } }))
    const broken = await rejection(fetchVersionHistory(PROJECT))
    assert.equal(broken.code, "server")
    assert.match(broken.message, /version history/i)
  })

  it("never builds a URL from an id that is not a UUID, and sends nothing", async () => {
    installFetch(() => ({ json: history }))
    for (const id of ["../admin", "a/b", "", "69112fc8", `${PROJECT}/versions`]) {
      assert.equal((await rejection(fetchVersionHistory(id))).code, "not_found", id)
      assert.equal((await rejection(fetchLatestProject(id))).code, "not_found", id)
    }
    for (const n of [0, -1, 1.5, NaN]) {
      assert.equal((await rejection(fetchVersion(PROJECT, n))).code, "not_found", String(n))
    }
    assert.equal(calls.length, 0)
  })

  it("is not available in demo mode, and sends nothing", async () => {
    setEnvironment({ mode: "mock" })
    installFetch(() => ({ json: history }))
    assert.equal((await rejection(fetchVersionHistory(PROJECT))).code, "config")
    assert.equal(calls.length, 0)
  })
})
