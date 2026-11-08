import { parseBlueprint, parseCapture } from "@/lib/blueprint-adapter"
import { isMockMode, isWebsiteDesign, type ApiMode } from "@/lib/site-revive-api"
import type { RedesignResult } from "@/types/website"

/**
 * Keeps the current redesign project in sessionStorage so it survives page
 * navigation and refresh (/redesign -> /preview). sessionStorage is per tab and
 * is cleared when the tab closes, so a user's URL is not kept around.
 *
 * Besides the design, a real-backend project stores the blueprint the design
 * was built from (prompt edits send it back to the backend) and the page
 * capture (needed to rebuild the design after an edit). The sample project
 * has neither.
 *
 * A project remembers the mode it was created in and is ignored in the other
 * one, so switching between "mock" and "api" can never show a sample result as
 * if it were real, or the other way round.
 *
 * Browser only: call these from event handlers and effects, never during render.
 */

// v2: projects now carry a mode, a blueprint and a capture. v1 entries are ignored.
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
 * Checks parsed storage contents and rebuilds the project from validated
 * parts. Returns null for anything unusable: damaged data, another mode, or an
 * "api" project without the blueprint that editing needs.
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
    typeof result.originalScreenshotUrl !== "string" ||
    !isWebsiteDesign(result.design)
  ) {
    return null
  }

  const restored: RedesignResult = {
    projectId: result.projectId,
    originalScreenshotUrl: result.originalScreenshotUrl,
    design: result.design,
  }

  if (result.blueprint !== undefined) {
    const blueprint = parseBlueprint(result.blueprint)
    if (!blueprint.ok) return null
    restored.blueprint = blueprint.value
  } else if (mode === "api") {
    return null
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
