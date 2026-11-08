import { parseBlueprint, parseCapture } from "@/lib/blueprint-adapter"
import { parseGeneratedPage } from "@/lib/generated-page"
import { isMockMode, isWebsiteDesign, type ApiMode } from "@/lib/site-revive-api"
import type { RedesignResult, SiteContent } from "@/types/website"

/**
 * Keeps the current redesign project in sessionStorage so it survives page
 * navigation and refresh (/redesign -> /preview). sessionStorage is per tab and
 * is cleared when the tab closes, so a user's URL is not kept around.
 *
 * This is the BROWSER's copy only: it lives in this tab, is gone when the tab
 * closes, and is not shared between tabs. The durable copy of every version is
 * the backend's (DynamoDB and S3); the app reads it back through
 * `fetchLatestProject` and the version history.
 *
 * What is kept here: the content being shown (a generated page, or an
 * earlier-format design with its blueprint), the saved version number it
 * corresponds to (sent back as `baseVersion` so the backend can refuse an edit
 * made on an outdated version), and the page capture (its address is the base
 * for the page's relative URLs). The sample project has no version or capture.
 *
 * A project remembers the mode it was created in and is ignored in the other
 * one, so switching between "mock" and "api" can never show a sample result as
 * if it were real, or the other way round.
 *
 * Browser only: call these from event handlers and effects, never during render.
 */

// v2: projects carry a mode. (v1 entries are ignored.) The content shape changed
// later without a new key because `restoreContent` reads both shapes.
const STORAGE_KEY = "siterevive.project.v2"

export interface StoredProject {
  /** The normalised URL the user submitted. */
  sourceUrl: string
  /** The mode the project was created in. */
  mode: ApiMode
  result: RedesignResult
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Rebuilds `content` from validated parts. Accepts the current shape
 * (`content`) and the shape stored before generated pages existed (`design`
 * and `blueprint` at the top level), so a project open in a tab survives an
 * upgrade of the app. Returns null for anything damaged.
 */
function restoreContent(result: Record<string, unknown>): SiteContent | null {
  if (isRecord(result.content)) {
    const stored = result.content
    if (stored.kind === "page") {
      const page = parseGeneratedPage(stored.page)
      return page.ok ? { kind: "page", page: page.value } : null
    }
    if (stored.kind === "design") {
      if (!isWebsiteDesign(stored.design)) return null
      if (stored.blueprint === undefined) return { kind: "design", design: stored.design }
      const blueprint = parseBlueprint(stored.blueprint)
      return blueprint.ok
        ? { kind: "design", design: stored.design, blueprint: blueprint.value }
        : null
    }
    return null
  }

  // Earlier shape.
  if (!isWebsiteDesign(result.design)) return null
  if (result.blueprint === undefined) return { kind: "design", design: result.design }
  const blueprint = parseBlueprint(result.blueprint)
  return blueprint.ok
    ? { kind: "design", design: result.design, blueprint: blueprint.value }
    : null
}

/**
 * Checks parsed storage contents and rebuilds the project from validated
 * parts. Returns null for anything unusable: damaged data, another mode, or an
 * earlier-format design without the blueprint that editing needs.
 */
function restoreProject(value: unknown): StoredProject | null {
  if (!isRecord(value)) return null
  const mode: ApiMode = isMockMode() ? "mock" : "api"
  if (typeof value.sourceUrl !== "string" || value.mode !== mode) return null

  const { result } = value
  if (
    !isRecord(result) ||
    typeof result.projectId !== "string" ||
    !result.projectId ||
    typeof result.originalScreenshotUrl !== "string"
  ) {
    return null
  }

  const content = restoreContent(result)
  if (!content) return null
  if (content.kind === "design" && !content.blueprint && mode === "api") return null

  const restored: RedesignResult = {
    projectId: result.projectId,
    originalScreenshotUrl: result.originalScreenshotUrl,
    content,
  }

  if (result.versionNumber !== undefined) {
    const version = result.versionNumber
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) return null
    restored.versionNumber = version
  }

  if (result.capture !== undefined) {
    const capture = parseCapture(result.capture)
    if (!capture.ok) return null
    restored.capture = capture.value
  }

  return { sourceUrl: value.sourceUrl, mode, result: restored }
}

/** Returns false if the browser refused the write (storage disabled or full). */
export function saveProject(sourceUrl: string, result: RedesignResult): boolean {
  try {
    const project: StoredProject = {
      sourceUrl,
      mode: isMockMode() ? "mock" : "api",
      result,
    }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(project))
    return true
  } catch {
    return false
  }
}

/**
 * The stored project exactly as saved (a JSON string), or null if there is
 * none. A string is a stable value, so React's useSyncExternalStore can compare
 * it between renders. Parse it with `parseStoredProject`.
 */
export function readStoredProjectJson(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Returns null if the JSON is missing, malformed or not a valid project for the current mode. */
export function parseStoredProject(raw: string | null): StoredProject | null {
  if (!raw) return null
  try {
    return restoreProject(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Returns null if nothing is stored or the stored data is not a valid project. */
export function loadProject(): StoredProject | null {
  return parseStoredProject(readStoredProjectJson())
}

export function clearProject(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
