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
import type { RedesignResult } from "@/types/website"

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

function apiResult(): RedesignResult {
  const adapted = adaptBlueprint(blueprint, capture)
  assert.ok(adapted.ok)
  return {
    projectId: capture.captureId,
    originalScreenshotUrl: capture.screenshots.desktop,
    design: adapted.value.design,
    blueprint: adapted.value.blueprint,
    capture,
  }
}

const mockResult: RedesignResult = {
  projectId: "proj_joescafe-com",
  originalScreenshotUrl: "/samples/original-website.svg",
  design: structuredClone(mockCafeDesign),
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
    assert.deepEqual(loaded.result.blueprint, result.blueprint)
    assert.deepEqual(loaded.result.capture, capture)
    assert.deepEqual(loaded.result.design, result.design)
    assert.equal(loaded.result.projectId, capture.captureId)
  })

  it("stores an edited blueprint over the original", () => {
    const original = apiResult()
    saveProject("https://joescafe.com/", original)

    const edited = structuredClone(original.blueprint)
    assert.ok(edited)
    edited.sections[1].content.headline = "Edited"
    saveProject("https://joescafe.com/", { ...original, blueprint: edited })

    assert.equal(loadProject()?.result.blueprint?.sections[1].content.headline, "Edited")
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

  it("ignores an api project that has no blueprint, since it could not be edited", () => {
    saveProject("https://joescafe.com/", { ...apiResult(), blueprint: undefined })
    assert.equal(loadProject(), null)
  })

  it("ignores a project whose blueprint or capture is damaged", () => {
    const raw = JSON.parse(JSON.stringify({ sourceUrl: "x", mode: "api", result: apiResult() }))
    raw.result.blueprint.sections = []
    assert.equal(parseStoredProject(JSON.stringify(raw)), null)

    const damagedCapture = JSON.parse(JSON.stringify({ sourceUrl: "x", mode: "api", result: apiResult() }))
    damagedCapture.result.capture = { captureId: 5 }
    assert.equal(parseStoredProject(JSON.stringify(damagedCapture)), null)
  })

  it("ignores a project whose design is not renderable", () => {
    const raw = JSON.parse(JSON.stringify({ sourceUrl: "x", mode: "api", result: apiResult() }))
    delete raw.result.design.hero
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
    assert.equal(loaded.result.blueprint, undefined)
    assert.deepEqual(loaded.result.design, mockResult.design)
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
