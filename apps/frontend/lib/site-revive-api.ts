import { adaptBlueprint, parseCapture } from "@/lib/blueprint-adapter"
import { deriveBusinessName } from "@/lib/business-name"
import { editWebsiteDesign } from "@/lib/design-editor"
import { parseGeneratedPage } from "@/lib/generated-page"
import { mockRedesign } from "@/lib/mock-site-revive"
import { safeExternalHref } from "@/lib/website-render"
import type { WebsiteBlueprint, WebsiteCapture } from "@/types/backend"
import type { GeneratedPage, RedesignResult, SiteContent, WebsiteDesign } from "@/types/website"

/**
 * Typed client for the SiteRevive backend (AWS Lambda API in apps/backend plus
 * the Playwright capture worker in apps/capture-worker, which calls Amazon
 * Bedrock). This is the only module that talks to the backend. UI code calls
 * `redesignWebsite` and `editWebsite` and does not care which mode is active.
 *
 * ---------------------------------------------------------------------------
 * Configuration (build-time, inlined into the browser bundle by Next.js)
 * ---------------------------------------------------------------------------
 *   NEXT_PUBLIC_SITE_REVIVE_API_MODE
 *       "mock" (default when unset) or "api".
 *   NEXT_PUBLIC_SITE_REVIVE_API_URL
 *       Origin of the backend API, e.g. http://localhost:3001 (sam local) or
 *       the API Gateway URL. Required when the mode is "api".
 *   NEXT_PUBLIC_SITE_REVIVE_SCREENSHOT_BASE_URL
 *       Optional. Origin that serves capture screenshots, e.g.
 *       http://localhost:3002. Only used when the backend returns screenshot
 *       paths such as "/artifacts/<id>-desktop.png" instead of full URLs (the
 *       backend returns full URLs when its CAPTURE_WORKER_PUBLIC_URL is set).
 *
 * All values are public: they end up in the JavaScript sent to every visitor.
 * Never put an AWS key, token or other secret in a NEXT_PUBLIC_ variable. This
 * client sends no credentials (no cookies, no Authorization header). Bedrock
 * and capture-worker credentials live only on the backend.
 *
 * Mode changes need a restart of `next dev` (values are read at build time).
 * In "api" mode a failed request is always reported as an error. It never falls
 * back to the built-in sample, so sample data cannot pass as a real result.
 *
 * ---------------------------------------------------------------------------
 * Backend contract (all synchronous, JSON, no polling)
 * ---------------------------------------------------------------------------
 *   POST /api/captures
 *     request   { sourceUrl }
 *     200 body  { ok: true, projectId, capture, sourceContent, screenshotKeys }
 *   POST /api/blueprints/generate
 *     request   { projectId?, businessName, businessType?, description?, sourceUrl?,
 *                 sourceContent?, redesignPrompt? }
 *     200 body  { ok: true, projectId, versionNumber, website: { html, css, javascript } }
 *   POST /api/blueprints/edit   (also /api/websites/edit)
 *     request   { projectId, baseVersion, prompt }      the backend loads the saved page
 *     200 body  { ok: true, projectId, versionNumber, website: { html, css, javascript } }
 *   GET  /api/projects/{projectId}                      { project, website }
 *   GET  /api/projects/{projectId}/versions             history list
 *   GET  /api/projects/{projectId}/versions/{number}    { version, website }
 *   Errors      non-2xx with { error: "<message>", details?, latestVersion? }
 *
 * Earlier backends returned a fixed-structure `blueprint` instead of `website`,
 * and edited it with { blueprint, prompt } (stateless). Both are still understood:
 * `normalizeResult` turns either into a SiteContent, and the legacy edit request
 * is still sent for results that hold a blueprint.
 *
 * One redesign is one project. The capture creates it, generate adds version 1
 * to it, and every edit adds the next version. Edits send `baseVersion`, and
 * the backend answers 409 if a newer version exists (for example after an edit
 * in another tab). Without a projectId the backend still works statelessly, and
 * this client falls back to that for backends that do not return one.
 *
 * A redesign is two sequential calls, capture then generate. Each is bounded
 * by the backend (the capture worker gives up after 28 s, the Lambda after
 * 45 s) and API Gateway's 30 s limit, so there are no job ids to poll. The
 * Zod schemas in packages/shared are the source of truth for these shapes.
 */

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

/** Body of POST /api/captures. */
export interface CaptureRequest {
  sourceUrl: string
}

/** Body of POST /api/blueprints/generate. */
export interface GenerateBlueprintRequest {
  /** The project created by /api/captures. Keeps the redesign under that project. */
  projectId?: string
  businessName: string
  businessType?: string
  description?: string
  sourceUrl?: string
  sourceContent?: string
  /** The owner's design direction ("How would you like to redesign this website?"). Optional. */
  redesignPrompt?: string
}

/** Body of POST /api/blueprints/edit for a generated page (the current format). */
export interface EditWebsiteRequest {
  projectId: string
  /** The version this edit is based on. The backend refuses it with 409 if a newer one exists. */
  baseVersion: number
  prompt: string
}

/** Body of POST /api/blueprints/edit for an earlier-format blueprint (stateless). */
export interface EditBlueprintRequest {
  /** Only understood by backends that saved blueprint versions. Ignored by the current one. */
  projectId?: string
  baseVersion?: number
  blueprint: WebsiteBlueprint
  prompt: string
}

/** What `redesignWebsite` hands to the UI. */
export type RedesignResponse = RedesignResult

export interface EditInput {
  projectId: string
  prompt: string
  /** What is shown now: a generated page, or an earlier-format design with its blueprint. */
  content: SiteContent
  /** The saved version of `content`. Required to edit a generated page. */
  versionNumber?: number
  /** The capture stored with the project. Optional. */
  capture?: WebsiteCapture
}

/** What `editWebsite` hands to the UI. The result of an edit has the same kind as its input. */
export interface EditOutcome {
  /** The updated content to show and store. Only ever returned when the edit really succeeded. */
  content: SiteContent
  /** The version the backend saved this edit as. Absent in mock mode or without versioning. */
  versionNumber?: number
  /**
   * False when nothing visible changed: in mock mode the design already matched,
   * in api mode the AI returned the same page, or only changed details a
   * blueprint design does not show.
   */
  changed: boolean
  /** Plain-language description of what happened, safe to show to the user. */
  summary: string
}

export type ApiMode = "mock" | "api"

/** Where a redesign is, so the UI can show real progress. */
export type RedesignStage = "capturing" | "designing"

export interface RequestOptions {
  /** Cancels the request. Rejects with code "aborted". */
  signal?: AbortSignal
  /** Overrides the default timeout of each HTTP request. */
  timeoutMs?: number
}

export interface RedesignOptions extends RequestOptions {
  /** Called when the redesign moves to a new stage. Not called in mock mode. */
  onStage?: (stage: RedesignStage) => void
  /** The owner's design direction. Sent to the model with the first generation. Optional. */
  instruction?: string
}

/** Prompt length limit. Matches the limit the existing editor already enforces. */
export const MAX_PROMPT_LENGTH = 300
/** The backend accepts up to 1000 characters of design direction (GenerateBlueprintRequestSchema). */
export const MAX_INSTRUCTION_LENGTH = 1000 // keep equal to lib/redesign-draft.ts
/** Opening the page and up to seven more, extracting content and taking two screenshots. */
export const CAPTURE_TIMEOUT_MS = 45_000
/**
 * One Bedrock call that writes a whole page. Measured with Claude Sonnet 5: 50
 * to 120 seconds (longer with a detailed design direction), so allow five minutes.
 */
export const GENERATE_TIMEOUT_MS = 300_000
/** One Bedrock call that rewrites the whole page. Similar to generating it. */
export const EDIT_TIMEOUT_MS = 300_000
/** Reading saved data: no model call, so it should be quick. */
export const HISTORY_TIMEOUT_MS = 20_000

/** Example instructions for the real backend. The AI rewrites the page, so most requests work. */
export const API_EDIT_EXAMPLES: readonly string[] = [
  "Change the main headline to Welcome to Our Cafe",
  "Make the colors warmer",
  "Add a short section about our story",
]

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type SiteReviveApiErrorCode =
  /** Environment variables are missing or invalid. */
  | "config"
  /** The request never reached the server (offline, DNS, CORS, refused). */
  | "network"
  | "timeout"
  | "aborted"
  /** HTTP 400 or 422. */
  | "bad_request"
  /** HTTP 404, or a project whose saved data is gone. */
  | "not_found"
  /** HTTP 429. */
  | "rate_limited"
  /** HTTP 409: the project has a newer version than the edit was based on. */
  | "conflict"
  /** HTTP 5xx or another unexpected status. */
  | "server"
  /** 2xx, but the body is not the agreed shape. */
  | "invalid_response"
  /** Mock mode only: the demo editor did not understand the instruction. */
  | "rejected"

/** `message` is plain language and safe to show to the user. */
export class SiteReviveApiError extends Error {
  readonly code: SiteReviveApiErrorCode
  readonly status?: number
  /** True when trying the same request again can reasonably succeed. */
  readonly retryable: boolean
  /**
   * Technical detail for developers (the backend's own error text). Never show
   * it to users: it can mention internals such as AWS or Playwright errors.
   */
  readonly detail?: string
  /** On a "conflict": the newest saved version number, as reported by the backend. */
  readonly latestVersion?: number

  constructor(
    code: SiteReviveApiErrorCode,
    message: string,
    options: {
      status?: number
      retryable?: boolean
      cause?: unknown
      detail?: string
      latestVersion?: number
    } = {}
  ) {
    super(message, { cause: options.cause })
    this.name = "SiteReviveApiError"
    this.code = code
    this.status = options.status
    this.retryable = options.retryable ?? false
    this.detail = options.detail
    this.latestVersion = options.latestVersion
  }
}

/** The user-safe message of an API error, or `fallback` for anything else. */
export function describeApiError(error: unknown, fallback: string): string {
  return error instanceof SiteReviveApiError && error.message
    ? error.message
    : fallback
}

/** Developer console hint. Silent in production builds. */
function warnInDevelopment(message: string): void {
  if (process.env.NODE_ENV !== "production") console.warn(`[SiteRevive API] ${message}`)
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Each variable must be read as a literal `process.env.NEXT_PUBLIC_*` so Next.js
 * can inline it. Dynamic lookups (`process.env[name]`) are not inlined. The
 * reads happen when a function runs, not when the module loads, which makes no
 * difference in the browser (the values are already inlined) and lets tests
 * switch modes.
 */
function readEnvironment() {
  return {
    mode: process.env.NEXT_PUBLIC_SITE_REVIVE_API_MODE,
    apiUrl: process.env.NEXT_PUBLIC_SITE_REVIVE_API_URL,
    screenshotUrl: process.env.NEXT_PUBLIC_SITE_REVIVE_SCREENSHOT_BASE_URL,
  }
}

type ApiConfig =
  | { mode: "mock" }
  | { mode: "api"; baseUrl: string; screenshotBaseUrl?: string }

function configError(detail: string): SiteReviveApiError {
  return new SiteReviveApiError(
    "config",
    `CARVER is not configured correctly: ${detail}`
  )
}

function configuredMode(): string {
  return (readEnvironment().mode ?? "").trim().toLowerCase() || "mock"
}

/**
 * True when the app runs on built-in sample data. Use it to label the UI. An
 * invalid mode value returns false, and the first API call then fails with a
 * "config" error instead of silently showing sample data.
 */
export function isMockMode(): boolean {
  return configuredMode() === "mock"
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

/** Validates a configured URL. Returns it without a trailing slash. */
function parseConfiguredUrl(raw: string, name: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw configError(`${name} is not a valid URL.`)
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw configError(`${name} must start with http:// or https://.`)
  }
  if (parsed.username || parsed.password) {
    // Public variables are visible to every visitor.
    throw configError(`${name} must not contain credentials.`)
  }
  if (
    process.env.NODE_ENV === "production" &&
    parsed.protocol !== "https:" &&
    !isLocalHost(parsed.hostname)
  ) {
    throw configError(`${name} must use https:// in production.`)
  }
  return parsed
}

function resolveConfig(): ApiConfig {
  const mode = configuredMode()
  if (mode === "mock") return { mode: "mock" }
  if (mode !== "api") {
    throw configError(
      `NEXT_PUBLIC_SITE_REVIVE_API_MODE must be "mock" or "api", not "${mode}".`
    )
  }

  const environment = readEnvironment()
  const rawUrl = (environment.apiUrl ?? "").trim()
  if (!rawUrl) {
    throw configError(
      'NEXT_PUBLIC_SITE_REVIVE_API_URL is not set (required when the mode is "api").'
    )
  }
  const api = parseConfiguredUrl(rawUrl, "NEXT_PUBLIC_SITE_REVIVE_API_URL")

  const rawScreenshots = (environment.screenshotUrl ?? "").trim()
  const screenshots = rawScreenshots
    ? parseConfiguredUrl(rawScreenshots, "NEXT_PUBLIC_SITE_REVIVE_SCREENSHOT_BASE_URL")
    : null

  return {
    mode: "api",
    baseUrl: api.origin + api.pathname.replace(/\/+$/, ""),
    ...(screenshots ? { screenshotBaseUrl: screenshots.origin } : {}),
  }
}

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Structural check of a design. It confirms the blocks the renderer reads exist
 * with the right container type, so a broken design is reported as an error
 * instead of crashing the preview. Individual values (colours, fonts, URLs) are
 * validated again when rendered. Designs built by the blueprint adapter always
 * pass; this also guards designs read back from storage.
 */
export function isWebsiteDesign(value: unknown): value is WebsiteDesign {
  if (!isObj(value)) return false
  if (value.schemaVersion !== 1 || typeof value.businessName !== "string") return false

  const { theme, navigation, hero, about, services, gallery, contact, footer } = value
  if (!isObj(theme) || !isObj(theme.colors) || !isObj(theme.typography)) return false
  if (!isObj(navigation) || !Array.isArray(navigation.items)) return false
  if (
    !isObj(hero) ||
    typeof hero.headline !== "string" ||
    !isObj(hero.primaryCta) ||
    !isObj(hero.image)
  ) {
    return false
  }
  if (!isObj(about) || !Array.isArray(about.body) || !Array.isArray(about.highlights)) {
    return false
  }
  if (!isObj(services) || !Array.isArray(services.items)) return false
  if (!isObj(gallery) || !Array.isArray(gallery.images)) return false
  if (!isObj(contact) || !isObj(contact.address) || !Array.isArray(contact.openingHours)) {
    return false
  }
  if (!isObj(footer) || !Array.isArray(footer.links) || !Array.isArray(footer.socialLinks)) {
    return false
  }

  return (
    Array.isArray(value.sections) &&
    value.sections.every(
      (section) =>
        isObj(section) &&
        typeof section.id === "string" &&
        typeof section.type === "string" &&
        typeof section.visible === "boolean"
    )
  )
}

/**
 * Turns the answer of generate, edit or a saved-project read into the one
 * SiteContent the app works with, whichever format the backend used:
 *
 * - `website: { html, css, javascript }` is a generated page (current format).
 * - `blueprint` is a fixed-structure blueprint (earlier format), converted by
 *   the blueprint adapter. `capture` fills what a blueprint has no field for.
 *
 * If both are present the page wins. Anything else, or a value that fails
 * validation, is an error with a reason for developers (never shown to users).
 */
export function normalizeResult(
  body: unknown,
  capture?: WebsiteCapture
): { ok: true; content: SiteContent } | { ok: false; error: string } {
  if (!isObj(body)) return { ok: false, error: "The answer is not an object." }

  if (body.website !== undefined) {
    const page = parseGeneratedPage(body.website)
    return page.ok
      ? { ok: true, content: { kind: "page", page: page.value } }
      : { ok: false, error: page.error }
  }

  if (body.blueprint !== undefined && body.blueprint !== null) {
    const adapted = adaptBlueprint(body.blueprint, capture)
    return adapted.ok
      ? {
          ok: true,
          content: {
            kind: "design",
            design: adapted.value.design,
            blueprint: adapted.value.blueprint,
          },
        }
      : { ok: false, error: adapted.error }
  }

  return { ok: false, error: "The answer has neither a website nor a blueprint." }
}

function samePage(a: GeneratedPage, b: GeneratedPage): boolean {
  return a.html === b.html && a.css === b.css && a.javascript === b.javascript
}

function invalidResponse(what: string, detail?: string): SiteReviveApiError {
  warnInDevelopment(`The backend sent an unreadable ${what}${detail ? `: ${detail}` : "."}`)
  return new SiteReviveApiError(
    "invalid_response",
    `The CARVER service sent a ${what} we couldn't read. Please try again.`,
    { retryable: true, detail }
  )
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

type Operation = "capture" | "generate" | "edit" | "history"

/** Message from { error: "..." }, { error: { message } } or { detail: "..." }, if present. */
function serverMessage(text: string): string | null {
  try {
    const body: unknown = JSON.parse(text)
    if (!isObj(body)) return null
    const message =
      typeof body.error === "string"
        ? body.error
        : isObj(body.error) && typeof body.error.message === "string"
          ? body.error.message
          : typeof body.detail === "string"
            ? body.detail
            : null
    const trimmed = message?.replace(/\s+/g, " ").trim()
    return trimmed ? trimmed.slice(0, 300) : null
  } catch {
    return null
  }
}

/**
 * Capture failures that are about the user's website and safe to show as the
 * backend wrote them. Anything else from a capture failure can be an internal
 * Playwright or network message, so it gets the generic text instead.
 */
const SHOWABLE_CAPTURE_FAILURE =
  /^(?:The website responded with HTTP \d{3}\.|The website could not be loaded\.)$/

const TEXT = {
  captureFailed:
    "We couldn't capture that website. It may be offline, slow, or blocking automated visits. Try again, or try a different page.",
  captureRejected: "That website address was not accepted. Check it and try again.",
  captureTimeout: "That website took too long to load, so we stopped waiting. Please try again.",
  generateFailed: "The AI couldn't create a design this time. Please try again.",
  generateRejected: "The CARVER service could not use that website's content. Please try again.",
  outputRejected:
    "The AI wrote a page that didn't pass our safety checks, so it was not used. Please try again.",
  outputTooLong:
    "The AI ran out of space while writing the page. Please try again, or ask for something simpler.",
  generateTimeout: "The AI took too long to answer, so we stopped waiting. Please try again.",
  editFailed:
    "We couldn't apply that change. Try rephrasing it, for example: Change the hero headline to Welcome.",
  editRejected: "That instruction couldn't be accepted. Try a shorter or clearer one.",
  editConflict:
    "This website was changed in another window, so your edit was not applied. Load the latest version, then enter your change again.",
  projectGone: "This project is no longer available. Start a new redesign.",
  historyFailed: "We couldn't load the version history. Please try again.",
  editTimeout: "The AI took too long to answer, so we stopped waiting. Please try again.",
} as const

/** `latestVersion` from a 409 body, if it is a sensible number. */
function serverLatestVersion(text: string): number | undefined {
  try {
    const body: unknown = JSON.parse(text)
    const value = isObj(body) ? body.latestVersion : undefined
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : undefined
  } catch {
    return undefined
  }
}

function httpError(status: number, text: string, operation: Operation): SiteReviveApiError {
  const detail = serverMessage(text) ?? undefined
  warnInDevelopment(
    `${operation} failed with HTTP ${status}${detail ? `: ${detail}` : "."}`
  )
  const base = { status, detail }

  if (status === 409) {
    return new SiteReviveApiError(
      "conflict",
      operation === "edit"
        ? TEXT.editConflict
        : "This website was already redesigned. Please try again to start a fresh redesign.",
      { ...base, retryable: operation !== "edit", latestVersion: serverLatestVersion(text) }
    )
  }
  if (status === 429) {
    return new SiteReviveApiError(
      "rate_limited",
      "Too many requests right now. Wait a moment and try again.",
      { ...base, retryable: true }
    )
  }
  if (status === 408 || status === 504) {
    const message =
      operation === "capture"
        ? TEXT.captureTimeout
        : operation === "generate"
          ? TEXT.generateTimeout
          : TEXT.editTimeout
    return new SiteReviveApiError("timeout", message, { ...base, retryable: true })
  }
  if (status === 401 || status === 403) {
    return new SiteReviveApiError(
      "server",
      "The CARVER service refused the request. Please try again later.",
      base
    )
  }
  if (status === 404) {
    // The backend says "Project not found." / "Version not found." for a missing
    // project. Anything else is a missing route or server.
    const projectMissing = (operation === "edit" || operation === "history") && /not found/i.test(detail ?? "")
    return new SiteReviveApiError(
      "not_found",
      projectMissing ? TEXT.projectGone : "The CARVER service could not be found. Please try again later.",
      base
    )
  }
  if (status === 400 || status === 422) {
    // Worker validation messages ("Local and internal network addresses cannot
    // be captured.") are written for users. Schema errors ("Invalid ...") are not.
    const showable = operation === "capture" && detail && !/^Invalid\b/i.test(detail)
    const message =
      operation === "capture"
        ? showable
          ? detail
          : TEXT.captureRejected
        : operation === "generate"
          ? TEXT.generateRejected
          : TEXT.editRejected
    return new SiteReviveApiError("bad_request", message, base)
  }

  const retryable = status >= 500
  if (operation === "generate" || operation === "edit") {
    // The backend words these itself; show our own plain text for them.
    if (/did not pass validation/i.test(detail ?? "")) {
      return new SiteReviveApiError("server", TEXT.outputRejected, { ...base, retryable })
    }
    if (/ran out of space/i.test(detail ?? "")) {
      return new SiteReviveApiError("server", TEXT.outputTooLong, { ...base, retryable })
    }
  }
  if (operation === "capture") {
    const message = detail && SHOWABLE_CAPTURE_FAILURE.test(detail) ? detail : TEXT.captureFailed
    return new SiteReviveApiError("server", message, { ...base, retryable })
  }
  return new SiteReviveApiError(
    "server",
    operation === "generate"
      ? TEXT.generateFailed
      : operation === "history"
        ? TEXT.historyFailed
        : TEXT.editFailed,
    { ...base, retryable }
  )
}

/** Sends a JSON request and returns the parsed 2xx body. Throws SiteReviveApiError only. */
async function requestJson(
  method: "GET" | "POST",
  baseUrl: string,
  path: string,
  body: unknown,
  operation: Operation,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<unknown> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const forwardAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener("abort", forwardAbort, { once: true })

  try {
    // Cancelled before it started: send nothing.
    if (signal?.aborted) {
      throw new SiteReviveApiError("aborted", "The request was cancelled.")
    }

    let response: Response
    let text: string
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers:
          method === "POST"
            ? { "Content-Type": "application/json", Accept: "application/json" }
            : { Accept: "application/json" },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        // No cookies or auth headers: nothing secret is sent from the browser.
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      })
      // The timeout also covers reading the body.
      text = await response.text()
    } catch (cause) {
      if (timedOut) {
        throw new SiteReviveApiError(
          "timeout",
          "This is taking longer than expected, so we stopped waiting. Please try again.",
          { retryable: true, cause }
        )
      }
      if (signal?.aborted) {
        throw new SiteReviveApiError("aborted", "The request was cancelled.", { cause })
      }
      warnInDevelopment(
        `${operation}: could not reach ${baseUrl}. Is the backend running, and does it allow requests from this origin (CORS)?`
      )
      throw new SiteReviveApiError(
        "network",
        "We couldn't reach the CARVER service. Check your connection and try again.",
        { retryable: true, cause }
      )
    }

    if (!response.ok) throw httpError(response.status, text, operation)

    try {
      return JSON.parse(text)
    } catch {
      throw invalidResponse("response")
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", forwardAbort)
  }
}

// ---------------------------------------------------------------------------
// Capture cache
// ---------------------------------------------------------------------------

/**
 * A capture takes 10 to 25 seconds and leaves screenshots on the worker. When
 * the capture succeeds but the AI step fails, "Try again" reuses it instead of
 * visiting the website a second time. Entries are dropped after a successful
 * redesign and expire after ten minutes, so a later redesign sees fresh content.
 */
const CAPTURE_CACHE_TTL_MS = 10 * 60 * 1000
const CAPTURE_CACHE_MAX_ENTRIES = 5

interface CapturedPage {
  /** The project the backend created for this capture. Absent on backends that do not keep projects. */
  projectId?: string
  capture: WebsiteCapture
  /** Preformatted page content for /api/blueprints/generate. */
  sourceContent?: string
}

const captureCache = new Map<string, { page: CapturedPage; at: number }>()

function cachedCapture(url: string): CapturedPage | null {
  const entry = captureCache.get(url)
  if (!entry) return null
  if (Date.now() - entry.at > CAPTURE_CACHE_TTL_MS) {
    captureCache.delete(url)
    return null
  }
  return entry.page
}

function rememberCapture(url: string, page: CapturedPage): void {
  captureCache.set(url, { page, at: Date.now() })
  while (captureCache.size > CAPTURE_CACHE_MAX_ENTRIES) {
    const oldest = captureCache.keys().next().value
    if (oldest === undefined) break
    captureCache.delete(oldest)
  }
}

/** Forgets every remembered capture. */
export function clearCaptureCache(): void {
  captureCache.clear()
}

// ---------------------------------------------------------------------------
// Redesign
// ---------------------------------------------------------------------------

/** The backend creates project ids with randomUUID(). Anything else is ignored. */
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validProjectId(value: unknown): string | undefined {
  return typeof value === "string" && PROJECT_ID.test(value) ? value : undefined
}

function validVersionNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : undefined
}

const MAX_SOURCE_URL_LENGTH = 2048
const MAX_DESCRIPTION_LENGTH = 1000
const MAX_SOURCE_CONTENT_LENGTH = 28_000

async function captureWebsite(
  config: Extract<ApiConfig, { mode: "api" }>,
  url: string,
  options: RedesignOptions
): Promise<CapturedPage> {
  const request: CaptureRequest = { sourceUrl: url }
  const body = await requestJson(
    "POST",
    config.baseUrl,
    "/api/captures",
    request,
    "capture",
    options.timeoutMs ?? CAPTURE_TIMEOUT_MS,
    options.signal
  )

  const parsed = parseCapture(isObj(body) ? body.capture : undefined)
  if (!parsed.ok) throw invalidResponse("page capture", parsed.error)

  return {
    projectId: isObj(body) ? validProjectId(body.projectId) : undefined,
    capture: parsed.value,
    sourceContent:
      isObj(body) && typeof body.sourceContent === "string" && body.sourceContent.trim()
        ? body.sourceContent
        : undefined,
  }
}

/**
 * The URL the browser can load the original-site screenshot from. Full http(s)
 * URLs are used as they are. A path such as "/artifacts/<id>-desktop.png" needs
 * the screenshot origin from the environment. Without it the screenshot cannot
 * be located, so "" is returned and the "Before" pane shows a text placeholder.
 */
function screenshotUrlFor(
  capture: WebsiteCapture,
  config: Extract<ApiConfig, { mode: "api" }>
): string {
  const raw = capture.screenshots.desktop.trim()
  const absolute = safeExternalHref(raw)
  if (absolute) return absolute

  if (raw.startsWith("/") && !raw.startsWith("//") && config.screenshotBaseUrl) {
    return safeExternalHref(`${config.screenshotBaseUrl}${raw}`) ?? ""
  }
  warnInDevelopment(
    "The capture's screenshot is a path, not a full URL. Set CAPTURE_WORKER_PUBLIC_URL on the backend or NEXT_PUBLIC_SITE_REVIVE_SCREENSHOT_BASE_URL here."
  )
  return ""
}

/** The capture as stored with a project: long page text is not needed again. */
function compactCapture(capture: WebsiteCapture): WebsiteCapture {
  return { ...capture, text: "", headings: [] }
}

/**
 * Creates a redesign for a website.
 *
 * Mock mode returns the sample cafe design immediately. The artificial pacing
 * that makes the demo feel real lives in `lib/redesign-job.ts`, not here.
 *
 * Api mode makes two requests: capture the page, then ask the model to write
 * the new site (optionally following `options.instruction`). The answer is
 * validated and normalized (see normalizeResult). A failed request rejects. It
 * never returns sample data.
 *
 * Rejects with SiteReviveApiError.
 */
export async function redesignWebsite(
  url: string,
  options: RedesignOptions = {}
): Promise<RedesignResponse> {
  const config = resolveConfig()

  if (config.mode === "mock") return mockRedesign(url)

  // 1. Capture (skipped when an earlier attempt already captured this URL).
  let page = cachedCapture(url)
  if (!page) {
    options.onStage?.("capturing")
    page = await captureWebsite(config, url, options)
    rememberCapture(url, page)
  }
  const { capture, sourceContent, projectId } = page

  // 2. Generate. The business name is a guess from the page title or domain.
  options.onStage?.("designing")
  const description = capture.description.trim().slice(0, MAX_DESCRIPTION_LENGTH)
  const instruction = (options.instruction ?? "").trim().slice(0, MAX_INSTRUCTION_LENGTH)
  const request: GenerateBlueprintRequest = {
    // Keeps the redesign under the project the capture created.
    ...(projectId ? { projectId } : {}),
    businessName: deriveBusinessName(capture.title, capture.finalUrl || url),
    ...(instruction ? { redesignPrompt: instruction } : {}),
    ...(description ? { description } : {}),
    ...(url.length <= MAX_SOURCE_URL_LENGTH ? { sourceUrl: url } : {}),
    ...(sourceContent ? { sourceContent: sourceContent.slice(0, MAX_SOURCE_CONTENT_LENGTH) } : {}),
  }
  let body: unknown
  try {
    body = await requestJson(
      "POST",
      config.baseUrl,
      "/api/blueprints/generate",
      request,
      "generate",
      options.timeoutMs ?? GENERATE_TIMEOUT_MS,
      options.signal
    )
  } catch (error) {
    // 409: this capture's project already has its first version (a previous
    // attempt succeeded but its answer never arrived). Retrying must start from
    // a fresh capture and project, so forget this one.
    if (error instanceof SiteReviveApiError && error.code === "conflict") captureCache.delete(url)
    throw error
  }

  // 3. Normalize. Validates the page (or converts a blueprint) and rejects anything else.
  const normalized = normalizeResult(body, capture)
  if (!normalized.ok) throw invalidResponse("website", normalized.error)

  captureCache.delete(url)
  // Prefer the project id the backend confirms; fall back to the one from the
  // capture, then to the capture id for backends that keep no projects.
  const savedProjectId = isObj(body) ? validProjectId(body.projectId) : undefined
  const versionNumber = isObj(body) ? validVersionNumber(body.versionNumber) : undefined
  return {
    projectId: savedProjectId ?? projectId ?? capture.captureId,
    originalScreenshotUrl: screenshotUrlFor(capture, config),
    content: normalized.content,
    ...(versionNumber ? { versionNumber } : {}),
    capture: compactCapture(capture),
  }
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

/** "primaryButtonText" becomes "primary button text". Letters and digits only. */
function fieldWords(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 30)
}

/**
 * Describes what a blueprint edit changed ("Updated the hero headline."), using
 * only section types and field names, never the AI's new values, which are
 * untrusted.
 */
function describeOperations(
  operations: unknown,
  sections: readonly { id: string; type: string }[]
): string {
  const parts: string[] = []
  for (const operation of Array.isArray(operations) ? operations : []) {
    if (!isObj(operation) || typeof operation.sectionId !== "string") continue
    if (typeof operation.field !== "string") continue
    const type = sections.find((section) => section.id === operation.sectionId)?.type
    const words = fieldWords(operation.field)
    if (!words) continue
    const label = type ? `${type} ${words}` : words
    if (!parts.includes(label)) parts.push(label)
  }
  if (parts.length === 0) return "Updated the design."
  const shown = parts.slice(0, 3).join(", ")
  const more = parts.length > 3 ? ` and ${parts.length - 3} more` : ""
  return `Updated the ${shown}${more}.`
}

const NOT_VISIBLE_SUMMARY =
  "The AI changed details that this preview doesn't show, so nothing looks different. Try asking for a visible change, such as the headline or a paragraph."

const SAME_PAGE_SUMMARY =
  "The AI returned the same page, so nothing looks different. Try describing the change in a different way."

const MISSING_DATA = "This project can't be edited because its saved data is missing. Start a new redesign."

/**
 * Applies a natural-language edit.
 *
 * - Mock mode edits the sample design locally.
 * - A generated page is sent as { projectId, baseVersion, prompt }: the backend
 *   loads the saved page, has the model rewrite it, saves the next version and
 *   returns the full new page. A newer saved version makes it answer 409.
 * - An earlier-format design is sent with its blueprint (stateless).
 *
 * The returned content is exactly what the backend returned and was validated.
 * On any failure this rejects and the caller keeps what it already shows.
 * Rejects with SiteReviveApiError.
 */
export async function editWebsite(
  input: EditInput,
  options: RequestOptions = {}
): Promise<EditOutcome> {
  const config = resolveConfig()

  const prompt = input.prompt.trim()
  if (!prompt) {
    throw new SiteReviveApiError("bad_request", "Type an instruction first.")
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new SiteReviveApiError(
      "bad_request",
      `That instruction is too long. Keep it under ${MAX_PROMPT_LENGTH} characters.`
    )
  }

  if (config.mode === "mock") {
    if (input.content.kind !== "design") {
      throw new SiteReviveApiError("config", "Demo mode can only edit the sample design.")
    }
    const result = await editWebsiteDesign(input.content.design, prompt)
    if (!result.ok) throw new SiteReviveApiError("rejected", result.error)
    return {
      content: { kind: "design", design: result.design },
      changed: result.changed,
      summary: result.summary,
    }
  }

  return input.content.kind === "page"
    ? editGeneratedPage(config, input, input.content.page, prompt, options)
    : editBlueprintDesign(config, input, input.content, prompt, options)
}

async function editGeneratedPage(
  config: Extract<ApiConfig, { mode: "api" }>,
  input: EditInput,
  current: GeneratedPage,
  prompt: string,
  options: RequestOptions
): Promise<EditOutcome> {
  const projectId = validProjectId(input.projectId)
  if (!projectId || input.versionNumber === undefined) {
    throw new SiteReviveApiError("not_found", MISSING_DATA)
  }

  const request: EditWebsiteRequest = { projectId, baseVersion: input.versionNumber, prompt }
  const body = await requestJson(
    "POST",
    config.baseUrl,
    "/api/blueprints/edit",
    request,
    "edit",
    options.timeoutMs ?? EDIT_TIMEOUT_MS,
    options.signal
  )

  const normalized = normalizeResult(body, input.capture)
  if (!normalized.ok || normalized.content.kind !== "page") {
    throw invalidResponse("website update", normalized.ok ? "the answer is not a page" : normalized.error)
  }
  // Without the new version number the next edit would be based on the wrong
  // version. Treat it as unreadable rather than guess.
  const versionNumber = isObj(body) ? validVersionNumber(body.versionNumber) : undefined
  if (versionNumber === undefined) {
    throw invalidResponse("website update", "the answer has no version number")
  }

  const changed = !samePage(current, normalized.content.page)
  return {
    content: normalized.content,
    versionNumber,
    changed,
    summary: changed ? "Updated your website." : SAME_PAGE_SUMMARY,
  }
}

async function editBlueprintDesign(
  config: Extract<ApiConfig, { mode: "api" }>,
  input: EditInput,
  current: Extract<SiteContent, { kind: "design" }>,
  prompt: string,
  options: RequestOptions
): Promise<EditOutcome> {
  if (!current.blueprint) throw new SiteReviveApiError("not_found", MISSING_DATA)

  // Explicit fields: the design and capture must never reach the network.
  // projectId + baseVersion are only understood by backends that saved
  // blueprint versions; the current backend ignores them for this request.
  const versioned = validProjectId(input.projectId) !== undefined && input.versionNumber !== undefined
  const request: EditBlueprintRequest = {
    ...(versioned ? { projectId: input.projectId, baseVersion: input.versionNumber } : {}),
    blueprint: current.blueprint,
    prompt,
  }
  const body = await requestJson(
    "POST",
    config.baseUrl,
    "/api/blueprints/edit",
    request,
    "edit",
    options.timeoutMs ?? EDIT_TIMEOUT_MS,
    options.signal
  )

  const normalized = normalizeResult(isObj(body) ? { blueprint: body.blueprint } : body, input.capture)
  if (!normalized.ok || normalized.content.kind !== "design") {
    throw invalidResponse("design update", normalized.ok ? "the answer is not a design" : normalized.error)
  }

  const { design, blueprint } = normalized.content
  const changed = JSON.stringify(design) !== JSON.stringify(current.design)
  const savedVersion = versioned && isObj(body) ? validVersionNumber(body.versionNumber) : undefined
  return {
    content: normalized.content,
    ...(savedVersion ? { versionNumber: savedVersion } : {}),
    changed,
    summary: changed
      ? describeOperations(isObj(body) ? body.operations : undefined, blueprint?.sections ?? [])
      : NOT_VISIBLE_SUMMARY,
  }
}

// ---------------------------------------------------------------------------
// Saved projects and version history
// ---------------------------------------------------------------------------

/** A project's state as saved by the backend. */
export interface SavedProject {
  content: SiteContent
  versionNumber: number
}

/** One entry of a project's version history. */
export interface VersionSummary {
  versionNumber: number
  /** "INITIAL" for the first redesign, "EDIT" for a prompt edit. */
  changeType: "INITIAL" | "EDIT"
  /** The instruction that created an EDIT version. Untrusted text: show it as text only. */
  prompt?: string
  /** ISO timestamp. */
  createdAt: string
}

function apiConfigOrThrow(): Extract<ApiConfig, { mode: "api" }> {
  const config = resolveConfig()
  if (config.mode !== "api") {
    throw new SiteReviveApiError(
      "config",
      "Version history needs the real backend. It is not available in demo mode."
    )
  }
  return config
}

function projectPath(projectId: string): string {
  const id = validProjectId(projectId)
  if (!id) throw new SiteReviveApiError("not_found", TEXT.projectGone)
  return `/api/projects/${id}`
}

/**
 * Loads the newest saved version of a project and converts it. Used to catch up
 * after another window edited the same project.
 */
export async function fetchLatestProject(
  projectId: string,
  capture?: WebsiteCapture,
  options: RequestOptions = {}
): Promise<SavedProject> {
  const config = apiConfigOrThrow()
  const body = await requestJson(
    "GET", config.baseUrl, projectPath(projectId), undefined, "history",
    options.timeoutMs ?? HISTORY_TIMEOUT_MS, options.signal
  )
  const versionNumber =
    isObj(body) && isObj(body.project) ? validVersionNumber(body.project.latestVersion) : undefined
  const normalized = normalizeResult(body, capture)
  if (!versionNumber || !normalized.ok) {
    throw invalidResponse("saved project", normalized.ok ? "no version number" : normalized.error)
  }
  return { content: normalized.content, versionNumber }
}

/** The project's versions, newest first. */
export async function fetchVersionHistory(
  projectId: string,
  options: RequestOptions = {}
): Promise<VersionSummary[]> {
  const config = apiConfigOrThrow()
  const body = await requestJson(
    "GET", config.baseUrl, `${projectPath(projectId)}/versions`, undefined, "history",
    options.timeoutMs ?? HISTORY_TIMEOUT_MS, options.signal
  )
  if (!isObj(body) || !Array.isArray(body.versions)) throw invalidResponse("version list")

  const versions: VersionSummary[] = []
  for (const entry of body.versions) {
    const versionNumber = isObj(entry) ? validVersionNumber(entry.versionNumber) : undefined
    if (!isObj(entry) || !versionNumber) continue
    const changeType = entry.changeType === "EDIT" ? "EDIT" : "INITIAL"
    const prompt = typeof entry.prompt === "string" ? entry.prompt.replace(/\s+/g, " ").trim().slice(0, 300) : ""
    versions.push({
      versionNumber,
      changeType,
      ...(prompt ? { prompt } : {}),
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
    })
  }
  return versions.sort((a, b) => b.versionNumber - a.versionNumber)
}

/** One saved version, converted for display. */
export async function fetchVersion(
  projectId: string,
  versionNumber: number,
  capture?: WebsiteCapture,
  options: RequestOptions = {}
): Promise<SavedProject> {
  const config = apiConfigOrThrow()
  if (validVersionNumber(versionNumber) === undefined) {
    throw new SiteReviveApiError("not_found", "That version does not exist.")
  }
  const body = await requestJson(
    "GET", config.baseUrl, `${projectPath(projectId)}/versions/${versionNumber}`, undefined,
    "history", options.timeoutMs ?? HISTORY_TIMEOUT_MS, options.signal
  )
  const normalized = normalizeResult(body, capture)
  if (!normalized.ok) throw invalidResponse("saved version", normalized.error)
  return { content: normalized.content, versionNumber }
}
