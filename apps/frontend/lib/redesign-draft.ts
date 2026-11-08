/**
 * Remembers what the user typed on the landing page (the website address and
 * the optional design direction) until a redesign succeeds, so that after a
 * failure they can try again, or go back and change the address, without
 * retyping a long instruction.
 *
 * Kept in sessionStorage: per tab, gone when the tab closes, never sent
 * anywhere. The design direction is deliberately NOT put in the /redesign URL,
 * where it would end up in browser history and server logs.
 *
 * Browser only: call from event handlers and effects, never during render
 * (`readDraftJson` is for useSyncExternalStore).
 */

const STORAGE_KEY = "siterevive.draft.v1"

/** Same limit the backend enforces on the design direction. */
export const MAX_INSTRUCTION_LENGTH = 1000

export interface RedesignDraft {
  /** The validated, normalised website address. */
  url: string
  /** The design direction, trimmed. Empty when the user left it blank. */
  instruction: string
}

/** Returns false if the browser refused the write. */
export function saveDraft(draft: RedesignDraft): boolean {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

/** The stored draft exactly as saved (a stable string for useSyncExternalStore). */
export function readDraftJson(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Returns null for missing, malformed or wrong-shaped data. */
export function parseDraft(raw: string | null): RedesignDraft | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null) return null
    const { url, instruction } = value as Partial<RedesignDraft>
    if (typeof url !== "string" || typeof instruction !== "string") return null
    return { url, instruction: instruction.slice(0, MAX_INSTRUCTION_LENGTH) }
  } catch {
    return null
  }
}

export function loadDraft(): RedesignDraft | null {
  return parseDraft(readDraftJson())
}

/** The design direction saved for exactly this address, or "" if there is none. */
export function instructionFor(url: string): string {
  const draft = loadDraft()
  return draft && draft.url === url ? draft.instruction.trim() : ""
}

export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
