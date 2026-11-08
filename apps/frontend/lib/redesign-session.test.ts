import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import {
  clearProject,
  loadProject,
  parseStoredProject,
  readStoredProjectJson,
  saveProject,
} from "@/lib/redesign-session"
import { mockCafeDesign } from "@/lib/mock-site-revive"
import { adaptBlueprint } from "@/lib/blueprint-adapter"
import type { WebsiteBlueprint, WebsiteCapture } from "@/types/backend"
import type { RedesignResult, SiteContent } from "@/types/website"

/** A minimal in-memory sessionStorage, installed as `window.sessionStorage`. */
class FakeStorage {
  items = new Map<string, string>()
  failWrites = false
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError")
    this.items.set(key, value)
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
}

const globals = globalThis as unknown as { window?: unknown }
const env = process.env as Record<string, string | undefined>
let storage: FakeStorage

function setMode(mode: "mock" | "api") {
  env.NEXT_PUBLIC_SITE_REVIVE_API_MODE = mode
  env.NEXT_PUBLIC_SITE_REVIVE_API_URL = "http://localhost:3001"
}

const blueprint: WebsiteBlueprint = {
  schemaVersion: "1.0",
  siteId: "demo-site",
  slug: "joes-cafe",
  businessName: "Joe's Café",
  description: "Great coffee.",
  theme: { primaryColor: "#112233", secondaryColor: "#F4F1EA", fontFamily: "Inter" },
  sections: [
    { id: "header-main", type: "header", visible: true, content: { navigation: ["About"] } },
    { id: "hero-main", type: "hero", visible: true, content: { headline: "Hello" } },
    { id: "about-main", type: "about", visible: true, content: { body: "About us." } },
  ],
}

const capture: WebsiteCapture = {
  captureId: "1bd89974-ee3d-4b89-b0f2-2138fad9724b",
  sourceUrl: "https://joescafe.com/",
  finalUrl: "https://joescafe.com/",
  capturedAt: "2026-11-07T10:00:00.000Z",
  title: "Joe's Café",
  description: "",
  headings: [],
  text: "",
  links: [],
  images: [{ src: "https://joescafe.com/a.jpg", alt: "" }],
  screenshots: { desktop: "http://localhost:3002/artifacts/x-desktop.png", mobile: "" },
}

/** An earlier-format (blueprint) result, as a backend that returns blueprints produces. */
function apiResult(): RedesignResult {
  const adapted = adaptBlueprint(blueprint, capture)
  assert.ok(adapted.ok)
  return {
    projectId: capture.captureId,
    originalScreenshotUrl: capture.screenshots.desktop,
    content: { kind: "design", design: adapted.value.design, blueprint: adapted.value.blueprint },
    capture,
  }
}

/** A generated-page result, the current format. */
const PAGE_CONTENT: SiteContent = {
  kind: "page",
  page: {
    html: '<h1 id="title">Hello</h1><button id="go" type="button">Go</button>',
    css: "body{margin:0}",
    javascript: "document.getElementById('go').addEventListener('click',function(){});",
  },
}
function pageResult(): RedesignResult {
  return {
    projectId: "69112fc8-f065-40e3-a706-99a23e69a8ad",
    originalScreenshotUrl: capture.screenshots.desktop,
    content: PAGE_CONTENT,
    versionNumber: 2,
    capture,
  }
}

const mockResult: RedesignResult = {
  projectId: "proj_joescafe-com",
  originalScreenshotUrl: "/samples/original-website.svg",
  content: { kind: "design", design: structuredClone(mockCafeDesign) },
}

/** Narrows content to the earlier "design" kind. */
function designContent(result: RedesignResult | undefined) {
  assert.ok(result)
  assert.equal(result.content.kind, "design")
  return result.content as Extract<SiteContent, { kind: "design" }>
}

beforeEach(() => {
  storage = new FakeStorage()
  globals.window = { sessionStorage: storage }
})

afterEach(() => {
  delete globals.window
})

describe("redesign session storage: api mode", () => {
  beforeEach(() => setMode("api"))

  it("keeps the design, blueprint and capture across a save and load", () => {
    const result = apiResult()
    assert.equal(saveProject("https://joescafe.com/", result), true)

    const loaded = loadProject()
    assert.ok(loaded)
    assert.equal(loaded.sourceUrl, "https://joescafe.com/")
    assert.equal(loaded.mode, "api")
    assert.deepEqual(designContent(loaded.result), designContent(result))
    assert.deepEqual(loaded.result.capture, capture)
    assert.equal(loaded.result.projectId, capture.captureId)
  })

  it("stores an edited blueprint over the original", () => {
    const original = apiResult()
    saveProject("https://joescafe.com/", original)

    const edited = structuredClone(designContent(original).blueprint)
    assert.ok(edited)
    edited.sections[1].content.headline = "Edited"
    saveProject("https://joescafe.com/", {
      ...original,
      content: { ...designContent(original), blueprint: edited },
    })

    assert.equal(designContent(loadProject()?.result).blueprint?.sections[1].content.headline, "Edited")
  })

  it("keeps a generated page exactly, with its version and capture", () => {
    saveProject("https://joescafe.com/", pageResult())
    const loaded = loadProject()
    assert.ok(loaded)
    assert.deepEqual(loaded.result.content, PAGE_CONTENT)
    assert.equal(loaded.result.versionNumber, 2)
    assert.equal(loaded.result.projectId, "69112fc8-f065-40e3-a706-99a23e69a8ad")
    assert.equal(loaded.result.capture?.finalUrl, "https://joescafe.com/")
  })

  it("needs no blueprint for a generated page", () => {
    saveProject("https://joescafe.com/", pageResult())
    assert.ok(loadProject())
  })

  it("ignores a stored page that fails validation", () => {
    for (const bad of [
      { html: "<script>x</script>", css: "", javascript: "" },
      { html: "<p onclick=\"x()\">a</p>", css: "", javascript: "" },
      { html: "<meta http-equiv=refresh content=\"0;url=https://evil.example\">", css: "", javascript: "" },
      { html: "<p>a</p>", css: "@import url(x);", javascript: "" },
      { html: "", css: "", javascript: "" },
      { html: 5, css: "", javascript: "" },
    ]) {
      const raw = JSON.parse(JSON.stringify({ sourceUrl: "x", mode: "api", result: pageResult() }))
      raw.result.content.page = bad
      assert.equal(parseStoredProject(JSON.stringify(raw)), null, JSON.stringify(bad).slice(0, 60))
    }
  })

  it("ignores content of an unknown kind", () => {
    const raw = JSON.parse(JSON.stringify({ sourceUrl: "x", mode: "api", result: pageResult() }))
    raw.result.content = { kind: "hologram", page: PAGE_CONTENT }
    assert.equal(parseStoredProject(JSON.stringify(raw)), null)
  })

  it("still reads a project stored in the earlier shape (design and blueprint at the top level)", () => {
    const current = apiResult()
    const earlier = {
      sourceUrl: "https://joescafe.com/",
      mode: "api",
      result: {
        projectId: current.projectId,
        originalScreenshotUrl: current.originalScreenshotUrl,
        design: designContent(current).design,
        blueprint: designContent(current).blueprint,
        capture,
      },
    }
    const loaded = parseStoredProject(JSON.stringify(earlier))
    assert.ok(loaded)
    assert.deepEqual(designContent(loaded.result), designContent(current))
  })

  it("keeps the saved version number so the next edit is based on it", () => {
    saveProject("https://joescafe.com/", { ...apiResult(), versionNumber: 3 })
    assert.equal(loadProject()?.result.versionNumber, 3)
    saveProject("https://joescafe.com/", apiResult())
    assert.equal(loadProject()?.result.versionNumber, undefined)
  })

  it("ignores a project with a damaged version number", () => {
    for (const versionNumber of [0, -1, 1.5, "2", null]) {
      const raw = JSON.parse(JSON.stringify({ sourceUrl: "x", mode: "api", result: apiResult() }))
      raw.result.versionNumber = versionNumber
      assert.equal(parseStoredProject(JSON.stringify(raw)), null, String(versionNumber))
    }
  })

  it("keeps an empty screenshot URL (the backend path could not be resolved)", () => {
    saveProject("https://joescafe.com/", { ...apiResult(), originalScreenshotUrl: "" })
    assert.equal(loadProject()?.result.originalScreenshotUrl, "")
  })

  it("ignores a project made in mock mode", () => {
    setMode("mock")
    saveProject("https://joescafe.com/", mockResult)
    setMode("api")
    assert.equal(loadProject(), null)
  })

  it("ignores an earlier-format api project that has no blueprint, since it could not be edited", () => {
    saveProject("https://joescafe.com/", {
      ...apiResult(),
      content: { kind: "design", design: designContent(apiResult()).design },
    })
    assert.equal(loadProject(), null)
  })

  it("ignores a project whose blueprint or capture is damaged", () => {
    const raw = JSON.parse(JSON.stringify({ sourceUrl: "x", mode: "api", result: apiResult() }))
    raw.result.content.blueprint.sections = []
    assert.equal(parseStoredProject(JSON.stringify(raw)), null)

    const damagedCapture = JSON.parse(JSON.stringify({ sourceUrl: "x", mode: "api", result: apiResult() }))
    damagedCapture.result.capture = { captureId: 5 }
    assert.equal(parseStoredProject(JSON.stringify(damagedCapture)), null)
  })

  it("ignores a project whose design is not renderable", () => {
    const raw = JSON.parse(JSON.stringify({ sourceUrl: "x", mode: "api", result: apiResult() }))
    delete raw.result.content.design.hero
    assert.equal(parseStoredProject(JSON.stringify(raw)), null)
  })
})

describe("redesign session storage: mock mode", () => {
  beforeEach(() => setMode("mock"))

  it("round-trips the sample project, which has no blueprint", () => {
    assert.equal(saveProject("https://joescafe.com/", mockResult), true)
    const loaded = loadProject()
    assert.ok(loaded)
    assert.equal(loaded.mode, "mock")
    assert.equal(designContent(loaded.result).blueprint, undefined)
    assert.deepEqual(designContent(loaded.result).design, designContent(mockResult).design)
  })

  it("ignores a project made with the real backend", () => {
    setMode("api")
    saveProject("https://joescafe.com/", apiResult())
    setMode("mock")
    assert.equal(loadProject(), null)
  })
})

describe("redesign session storage: general", () => {
  beforeEach(() => setMode("api"))

  it("ignores data saved by the previous storage version", () => {
    storage.items.set("siterevive.project.v1", JSON.stringify({ sourceUrl: "x", result: mockResult }))
    assert.equal(loadProject(), null)
    assert.equal(readStoredProjectJson(), null)
  })

  it("returns null for missing, malformed or wrong-shaped JSON", () => {
    for (const raw of [null, "", "{", "null", "[]", '"text"', "{}", '{"sourceUrl":1}']) {
      assert.equal(parseStoredProject(raw), null, String(raw))
    }
  })

  it("reports a write the browser refused", () => {
    storage.failWrites = true
    assert.equal(saveProject("https://joescafe.com/", apiResult()), false)
  })

  it("clears the project", () => {
    saveProject("https://joescafe.com/", apiResult())
    clearProject()
    assert.equal(loadProject(), null)
  })

  it("does not throw when storage is unavailable", () => {
    delete globals.window
    assert.equal(saveProject("x", apiResult()), false)
    assert.equal(readStoredProjectJson(), null)
    assert.doesNotThrow(() => clearProject())
  })
})
