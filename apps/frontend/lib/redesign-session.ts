import type { RedesignResult } from "@/types/website"

/**
 * Keeps the current redesign project in sessionStorage so it survives page
 * navigation and refresh (/redesign -> /preview). sessionStorage is per tab and
 * is cleared when the tab closes, so a user's URL is not kept around.
 *
 * Browser only: call these from event handlers and effects, never during render.
 */

const STORAGE_KEY = "siterevive.project.v1"

export interface StoredProject {
  /** The normalised URL the user submitted. */
  sourceUrl: string
  result: RedesignResult
}

function isStoredProject(value: unknown): value is StoredProject {
  if (typeof value !== "object" || value === null) return false
  const { sourceUrl, result } = value as Partial<StoredProject>
  if (typeof sourceUrl !== "string") return false
  if (typeof result !== "object" || result === null) return false
  return (
    typeof result.projectId === "string" &&
    typeof result.originalScreenshotUrl === "string" &&
    typeof result.design === "object" &&
    result.design !== null &&
    result.design.schemaVersion === 1 &&
    typeof result.design.businessName === "string" &&
    Array.isArray(result.design.sections)
  )
}

/** Returns false if the browser refused the write (storage disabled or full). */
export function saveProject(sourceUrl: string, result: RedesignResult): boolean {
  try {
    const project: StoredProject = { sourceUrl, result }
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

/** Returns null if the JSON is missing, malformed or not a valid project. */
export function parseStoredProject(raw: string | null): StoredProject | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isStoredProject(parsed) ? parsed : null
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
