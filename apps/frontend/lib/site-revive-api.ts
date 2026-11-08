import { adaptBlueprint, parseCapture } from "@/lib/blueprint-adapter"
import { deriveBusinessName } from "@/lib/business-name"
import { editWebsiteDesign } from "@/lib/design-editor"
import { mockRedesign } from "@/lib/mock-site-revive"
import { safeExternalHref } from "@/lib/website-render"
import type {
  BlueprintSection,
  WebsiteBlueprint,
  WebsiteCapture,
} from "@/types/backend"
import type { RedesignResult, WebsiteDesign } from "@/types/website"

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
 *     200 body  { ok: true, capture, sourceContent }
 *   POST /api/blueprints/generate
 *     request   { businessName, businessType?, description?, sourceUrl?, sourceContent? }
 *     200 body  { ok: true, blueprint }
 *   POST /api/blueprints/edit
 *     request   { blueprint, prompt }          (the backend keeps no state)
 *     200 body  { ok: true, blueprint, operations }
 *   Errors      non-2xx with { error: "<message>", details? }
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
  businessName: string
  businessType?: string
  description?: string
  sourceUrl?: string
  sourceContent?: string
}

/** Body of POST /api/blueprints/edit. */
export interface EditBlueprintRequest {
  blueprint: WebsiteBlueprint
  prompt: string
}

/** What `redesignWebsite` hands to the UI. */
export type RedesignResponse = RedesignResult

export interface EditInput {
  projectId: string
  prompt: string
  /** The design currently shown. Used to detect edits that change nothing visible. */
  currentDesign: WebsiteDesign
  /** The blueprint behind `currentDesign`. Required in "api" mode, unused in "mock" mode. */
  blueprint?: WebsiteBlueprint
  /** The capture stored with the project. Optional. */
  capture?: WebsiteCapture
}

/** What `editWebsite` hands to the UI. */
export interface EditOutcome {
  design: WebsiteDesign
  /** The updated blueprint to store for the next edit. Absent in mock mode. */
  blueprint?: WebsiteBlueprint
  /**
   * False when nothing visible changed: in mock mode the design already matched,
   * in api mode the backend only changed details the preview does not show.
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
}

/** Prompt length limit. Matches the limit the existing editor already enforces. */
export const MAX_PROMPT_LENGTH = 300
/** Opening the page, extracting content and taking two screenshots. */
export const CAPTURE_TIMEOUT_MS = 45_000
/** One Bedrock call that writes a whole blueprint. */
export const GENERATE_TIMEOUT_MS = 60_000
/** One Bedrock call that returns a few edit operations. */
export const EDIT_TIMEOUT_MS = 45_000

/** Example instructions the real backend can follow (text edits inside sections). */
export const API_EDIT_EXAMPLES: readonly string[] = [
  "Change the hero headline to Welcome to Our Cafe",
  "Change the hero button text to Contact Us",
  "Rewrite the about text to be shorter",
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

  constructor(
    code: SiteReviveApiErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; cause?: unknown; detail?: string } = {}
  ) {
    super(message, { cause: options.cause })
    this.name = "SiteReviveApiError"
    this.code = code
    this.status = options.status
    this.retryable = options.retryable ?? false
    this.detail = options.detail
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

function invalidResponse(what: string, detail?: string): SiteReviveApiError {
  warnInDevelopment(`The backend sent an unreadable ${what}${detail ? `: ${detail}` : "."}`)
  return new SiteReviveApiError(
    "invalid_response",
<<<<<<< HEAD
    `The SiteRevive service sent a ${what} we couldn't read. Please try again.`,
    { retryable: true, detail }
=======
    `The CARVER service sent a ${what} we couldn't read. Please try again.`,
    { retryable: true }
>>>>>>> 6741a30c336db980f9c311bf3a73dfd0fa89e7f3
  )
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

type Operation = "capture" | "generate" | "edit"

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
  generateRejected: "The SiteRevive service could not use that website's content. Please try again.",
  generateTimeout: "The AI took too long to answer, so we stopped waiting. Please try again.",
  editFailed:
    "We couldn't apply that change. Try rephrasing it, for example: Change the hero headline to Welcome.",
  editRejected: "That instruction couldn't be accepted. Try a shorter or clearer one.",
  editTimeout: "The AI took too long to answer, so we stopped waiting. Please try again.",
} as const

function httpError(status: number, text: string, operation: Operation): SiteReviveApiError {
  const detail = serverMessage(text) ?? undefined
  warnInDevelopment(
    `${operation} failed with HTTP ${status}${detail ? `: ${detail}` : "."}`
  )
  const base = { status, detail }

  if (status === 429) {
    return new SiteReviveApiError(
<<<<<<< HEAD
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
      "The SiteRevive service refused the request. Please try again later.",
      base
=======
      "bad_request",
      serverMessage(text) ?? "The CARVER service could not accept that request.",
      { status }
>>>>>>> 6741a30c336db980f9c311bf3a73dfd0fa89e7f3
    )
  }
  if (status === 404) {
    return new SiteReviveApiError(
      "not_found",
<<<<<<< HEAD
      "The SiteRevive service could not be found. Please try again later.",
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
=======
      operation === "edit"
        ? "This project is no longer available. Start a new redesign."
        : "The CARVER service could not be found. Please try again later.",
      { status }
    )
  }
  if (status === 408 || status === 504) {
    return new SiteReviveApiError(
      "timeout",
      "The CARVER service took too long to answer. Please try again.",
      { status, retryable: true }
    )
>>>>>>> 6741a30c336db980f9c311bf3a73dfd0fa89e7f3
  }

  const retryable = status >= 500
  if (operation === "capture") {
    const message = detail && SHOWABLE_CAPTURE_FAILURE.test(detail) ? detail : TEXT.captureFailed
    return new SiteReviveApiError("server", message, { ...base, retryable })
  }
  return new SiteReviveApiError(
    "server",
<<<<<<< HEAD
    operation === "generate" ? TEXT.generateFailed : TEXT.editFailed,
    { ...base, retryable }
=======
    "The CARVER service ran into a problem. Please try again.",
    { status, retryable: status >= 500 }
>>>>>>> 6741a30c336db980f9c311bf3a73dfd0fa89e7f3
  )
}

/** POSTs JSON and returns the parsed 2xx body. Throws SiteReviveApiError only. */
async function postJson(
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
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
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

<<<<<<< HEAD
=======
    if (response.status === 202) {
      throw new SiteReviveApiError(
        "async_unsupported",
        "The CARVER service started a background job, which this version of the app can't follow yet.",
        { status: 202 }
      )
    }
>>>>>>> 6741a30c336db980f9c311bf3a73dfd0fa89e7f3
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

const MAX_SOURCE_URL_LENGTH = 2048
const MAX_DESCRIPTION_LENGTH = 1000
const MAX_SOURCE_CONTENT_LENGTH = 12_000

async function captureWebsite(
  config: Extract<ApiConfig, { mode: "api" }>,
  url: string,
  options: RedesignOptions
): Promise<CapturedPage> {
  const request: CaptureRequest = { sourceUrl: url }
  const body = await postJson(
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
 * Api mode makes two requests: capture the page, then generate a blueprint
 * from the captured content, and converts the blueprint to a design. A failed
 * request rejects. It never returns sample data.
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
  const { capture, sourceContent } = page

  // 2. Generate. The business name is a guess from the page title or domain.
  options.onStage?.("designing")
  const description = capture.description.trim().slice(0, MAX_DESCRIPTION_LENGTH)
  const request: GenerateBlueprintRequest = {
    businessName: deriveBusinessName(capture.title, capture.finalUrl || url),
    ...(description ? { description } : {}),
    ...(url.length <= MAX_SOURCE_URL_LENGTH ? { sourceUrl: url } : {}),
    ...(sourceContent ? { sourceContent: sourceContent.slice(0, MAX_SOURCE_CONTENT_LENGTH) } : {}),
  }
  const body = await postJson(
    config.baseUrl,
    "/api/blueprints/generate",
    request,
    "generate",
    options.timeoutMs ?? GENERATE_TIMEOUT_MS,
    options.signal
  )

  // 3. Convert. The adapter validates the blueprint and fills any gaps.
  const adapted = adaptBlueprint(isObj(body) ? body.blueprint : undefined, capture)
  if (!adapted.ok) throw invalidResponse("website design", adapted.error)

  captureCache.delete(url)
  return {
    projectId: capture.captureId,
    originalScreenshotUrl: screenshotUrlFor(capture, config),
    design: adapted.value.design,
    blueprint: adapted.value.blueprint,
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
 * Describes what the backend changed ("Updated the hero headline."), using only
 * section types and field names, never the AI's new values, which are untrusted.
 */
function describeOperations(
  operations: unknown,
  sections: readonly BlueprintSection[]
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

/**
 * Applies a natural-language edit to a project's design.
 *
 * Mock mode edits the design locally. Api mode sends the stored blueprint and
 * the instruction to /api/blueprints/edit, then converts the blueprint it gets
 * back. Rejects with SiteReviveApiError.
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
    const result = await editWebsiteDesign(input.currentDesign, prompt)
    if (!result.ok) throw new SiteReviveApiError("rejected", result.error)
    return { design: result.design, changed: result.changed, summary: result.summary }
  }

  if (!input.blueprint) {
    throw new SiteReviveApiError(
      "not_found",
      "This project can't be edited because its saved data is missing. Start a new redesign."
    )
  }

  // Explicit fields: the design and capture must never reach the network.
  const request: EditBlueprintRequest = { blueprint: input.blueprint, prompt }
  const body = await postJson(
    config.baseUrl,
    "/api/blueprints/edit",
    request,
    "edit",
    options.timeoutMs ?? EDIT_TIMEOUT_MS,
    options.signal
  )

  const adapted = adaptBlueprint(isObj(body) ? body.blueprint : undefined, input.capture)
  if (!adapted.ok) throw invalidResponse("design update", adapted.error)

  const { design, blueprint } = adapted.value
  const changed = JSON.stringify(design) !== JSON.stringify(input.currentDesign)
  return {
    design,
    blueprint,
    changed,
    summary: changed
      ? describeOperations(isObj(body) ? body.operations : undefined, blueprint.sections)
      : NOT_VISIBLE_SUMMARY,
  }
}
