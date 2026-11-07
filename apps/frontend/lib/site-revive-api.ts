import { editWebsiteDesign } from "@/lib/design-editor"
import { mockRedesign } from "@/lib/mock-site-revive"
import { isSafeImageSrc } from "@/lib/website-render"
import type { RedesignResult, WebsiteDesign } from "@/types/website"

/**
 * Typed client for the SiteRevive backend (FastAPI + Playwright + Bedrock).
 * This is the only module that talks to the backend. UI code calls
 * `redesignWebsite` and `editWebsite` and does not care which mode is active.
 *
 * ---------------------------------------------------------------------------
 * Configuration (build-time, inlined into the browser bundle by Next.js)
 * ---------------------------------------------------------------------------
 *   NEXT_PUBLIC_SITE_REVIVE_API_MODE  "mock" (default when unset) | "api"
 *   NEXT_PUBLIC_SITE_REVIVE_API_URL   Backend origin, e.g. https://api.example.com
 *                                     Required when mode is "api".
 *
 * Both values are public: they end up in the JavaScript sent to every visitor.
 * Never put an AWS access key, secret key, session token, API Gateway key or
 * any other secret in a NEXT_PUBLIC_ variable. This client sends no credentials
 * (no cookies, no Authorization header). The browser never talks to AWS
 * services directly. Bedrock and S3 credentials live only on the backend.
 *
 * ---------------------------------------------------------------------------
 * Backend contract (synchronous, as proposed)
 * ---------------------------------------------------------------------------
 *   POST {API_URL}/api/redesign
 *     request   { "url": "https://example.com" }
 *     200 body  { "projectId": string, "originalScreenshotUrl": string,
 *                 "design": WebsiteDesign }
 *
 *   POST {API_URL}/api/edit
 *     request   { "projectId": string, "prompt": string }
 *     200 body  { "design": WebsiteDesign }
 *
 *   Both: Content-Type: application/json. Error responses use a non-2xx
 *   status and, ideally, the body { "error": { "code": string, "message": string } }.
 *   FastAPI's default { "detail": "..." } is also understood. The `message` of
 *   a 400/404/422 response is shown to the user, so it must be safe to display.
 *   The backend must answer CORS preflight for the frontend origin. Because no
 *   credentials are sent, it must not require `Allow-Credentials`.
 *
 * ---------------------------------------------------------------------------
 * If the backend uses asynchronous jobs (NOT implemented here)
 * ---------------------------------------------------------------------------
 * A redesign (Playwright capture + Bedrock) may outlast common gateway limits
 * (API Gateway REST default 29 s, ALB idle timeout default 60 s). If the backend
 * team moves to jobs, the backend team must define and document these, and this
 * client will be extended to match. This module does not guess endpoint names.
 *   1. Start: POST /api/redesign must answer quickly with HTTP 202 and a body
 *      that identifies the job and says where to read its status.
 *   2. Status read: one request that returns the job state. The frontend needs
 *      at least: a state of queued | running | succeeded | failed, optionally
 *      the current stage (one of the four stages shown in the UI) so the
 *      progress list can show real progress, and a suggested poll interval.
 *   3. Success: the final status response (or a result URL it points to)
 *      carries exactly the 200 body of the synchronous contract above.
 *   4. Failure: the status response carries the same { error: { code, message } }
 *      shape, with a flag saying whether retrying can help.
 *   5. Job lifetime: how long a finished job and its projectId stay readable.
 *   6. Same rules for /api/edit if edits can also take longer than the gateway limit.
 * Until then, a 202 response is reported to the user as "async_unsupported".
 */

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

/** Body of POST /api/redesign. */
export interface RedesignRequest {
  url: string
}

/** 200 body of POST /api/redesign. Same shape the UI already stores. */
export type RedesignResponse = RedesignResult

/** Body of POST /api/edit. */
export interface EditRequest {
  projectId: string
  prompt: string
}

/** 200 body of POST /api/edit. */
export interface EditResponse {
  design: WebsiteDesign
}

/** What `editWebsite` hands to the UI. */
export interface EditOutcome extends EditResponse {
  /** Plain-language description of what happened, safe to show to the user. */
  summary: string
}

export type ApiMode = "mock" | "api"

export interface RequestOptions {
  /** Cancels the request. Rejects with code "aborted". */
  signal?: AbortSignal
  /** Overrides the default timeout for this request. */
  timeoutMs?: number
}

/** Prompt length limit. Matches the limit the existing editor already enforces. */
export const MAX_PROMPT_LENGTH = 300
/** Capture and redesign are slow (page load, screenshot, model call). */
export const REDESIGN_TIMEOUT_MS = 120_000
export const EDIT_TIMEOUT_MS = 60_000

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
  /** HTTP 404, e.g. the project no longer exists. */
  | "not_found"
  /** HTTP 429. */
  | "rate_limited"
  /** HTTP 5xx or another unexpected status. */
  | "server"
  /** HTTP 202: the backend started an asynchronous job, which is not supported yet. */
  | "async_unsupported"
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

  constructor(
    code: SiteReviveApiErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause })
    this.name = "SiteReviveApiError"
    this.code = code
    this.status = options.status
    this.retryable = options.retryable ?? false
  }
}

/** The user-safe message of an API error, or `fallback` for anything else. */
export function describeApiError(error: unknown, fallback: string): string {
  return error instanceof SiteReviveApiError && error.message
    ? error.message
    : fallback
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Each variable must be read as a literal `process.env.NEXT_PUBLIC_*` so Next.js
// can inline it. Dynamic lookups are not inlined.
const MODE_ENV = process.env.NEXT_PUBLIC_SITE_REVIVE_API_MODE
const URL_ENV = process.env.NEXT_PUBLIC_SITE_REVIVE_API_URL

type ApiConfig = { mode: "mock" } | { mode: "api"; baseUrl: string }

function configError(detail: string): SiteReviveApiError {
  return new SiteReviveApiError(
    "config",
    `SiteRevive is not configured correctly: ${detail}`
  )
}

function configuredMode(): string {
  return (MODE_ENV ?? "").trim().toLowerCase() || "mock"
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

function resolveConfig(): ApiConfig {
  const mode = configuredMode()
  if (mode === "mock") return { mode: "mock" }
  if (mode !== "api") {
    throw configError(
      `NEXT_PUBLIC_SITE_REVIVE_API_MODE must be "mock" or "api", not "${mode}".`
    )
  }

  const raw = (URL_ENV ?? "").trim()
  if (!raw) {
    throw configError(
      'NEXT_PUBLIC_SITE_REVIVE_API_URL is not set (required when the mode is "api").'
    )
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw configError("NEXT_PUBLIC_SITE_REVIVE_API_URL is not a valid URL.")
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw configError("NEXT_PUBLIC_SITE_REVIVE_API_URL must start with http:// or https://.")
  }
  if (parsed.username || parsed.password) {
    // Public variables are visible to every visitor.
    throw configError("NEXT_PUBLIC_SITE_REVIVE_API_URL must not contain credentials.")
  }
  if (
    process.env.NODE_ENV === "production" &&
    parsed.protocol !== "https:" &&
    !isLocalHost(parsed.hostname)
  ) {
    throw configError("NEXT_PUBLIC_SITE_REVIVE_API_URL must use https:// in production.")
  }

  return { mode: "api", baseUrl: parsed.origin + parsed.pathname.replace(/\/+$/, "") }
}

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Structural check of a design from the network. It confirms the blocks the
 * renderer reads exist with the right container type, so a broken response is
 * reported as an error here instead of crashing the preview. Individual values
 * (colours, fonts, URLs) are validated again when rendered.
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

function invalidResponse(what: string): SiteReviveApiError {
  return new SiteReviveApiError(
    "invalid_response",
    `The SiteRevive service sent a ${what} we couldn't read. Please try again.`,
    { retryable: true }
  )
}

function parseRedesignResponse(body: unknown): RedesignResponse {
  if (
    !isObj(body) ||
    typeof body.projectId !== "string" ||
    !body.projectId ||
    !isSafeImageSrc(body.originalScreenshotUrl) ||
    !isWebsiteDesign(body.design)
  ) {
    throw invalidResponse("redesign result")
  }
  return {
    projectId: body.projectId,
    originalScreenshotUrl: body.originalScreenshotUrl,
    design: body.design,
  }
}

function parseEditResponse(body: unknown): EditResponse {
  if (!isObj(body) || !isWebsiteDesign(body.design)) {
    throw invalidResponse("design update")
  }
  return { design: body.design }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

type Operation = "redesign" | "edit"

/** Message from { error: { message } } or FastAPI's { detail: "..." }, if present. */
function serverMessage(text: string): string | null {
  try {
    const body: unknown = JSON.parse(text)
    if (!isObj(body)) return null
    const message =
      isObj(body.error) && typeof body.error.message === "string"
        ? body.error.message
        : typeof body.detail === "string"
          ? body.detail
          : null
    const trimmed = message?.trim()
    return trimmed ? trimmed.slice(0, 300) : null
  } catch {
    return null
  }
}

function httpError(status: number, text: string, operation: Operation): SiteReviveApiError {
  if (status === 400 || status === 422) {
    return new SiteReviveApiError(
      "bad_request",
      serverMessage(text) ?? "The SiteRevive service could not accept that request.",
      { status }
    )
  }
  if (status === 404) {
    return new SiteReviveApiError(
      "not_found",
      operation === "edit"
        ? "This project is no longer available. Start a new redesign."
        : "The SiteRevive service could not be found. Please try again later.",
      { status }
    )
  }
  if (status === 408 || status === 504) {
    return new SiteReviveApiError(
      "timeout",
      "The SiteRevive service took too long to answer. Please try again.",
      { status, retryable: true }
    )
  }
  if (status === 429) {
    return new SiteReviveApiError(
      "rate_limited",
      "Too many requests right now. Wait a moment and try again.",
      { status, retryable: true }
    )
  }
  return new SiteReviveApiError(
    "server",
    "The SiteRevive service ran into a problem. Please try again.",
    { status, retryable: status >= 500 }
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
      throw new SiteReviveApiError(
        "network",
        "We couldn't reach the SiteRevive service. Check your connection and try again.",
        { retryable: true, cause }
      )
    }

    if (response.status === 202) {
      throw new SiteReviveApiError(
        "async_unsupported",
        "The SiteRevive service started a background job, which this version of the app can't follow yet.",
        { status: 202 }
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a redesign for a website.
 * Mock mode returns the sample cafe design immediately. The artificial pacing
 * that makes the demo feel real lives in `lib/redesign-job.ts`, not here.
 * Rejects with SiteReviveApiError.
 */
export async function redesignWebsite(
  url: string,
  options: RequestOptions = {}
): Promise<RedesignResponse> {
  const config = resolveConfig()

  if (config.mode === "mock") return mockRedesign(url)

  const request: RedesignRequest = { url }
  const body = await postJson(
    config.baseUrl,
    "/api/redesign",
    request,
    "redesign",
    options.timeoutMs ?? REDESIGN_TIMEOUT_MS,
    options.signal
  )
  return parseRedesignResponse(body)
}

export interface EditInput extends EditRequest {
  /**
   * The design currently shown. Used in mock mode only, because the demo editor
   * changes a design locally. It is never sent to the backend: the backend
   * holds the latest design for `projectId`.
   */
  currentDesign: WebsiteDesign
}

/**
 * Applies a natural-language edit to a project's design.
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
    const result = await editWebsiteDesign(input.currentDesign, prompt)
    if (!result.ok) throw new SiteReviveApiError("rejected", result.error)
    return { design: result.design, summary: result.summary }
  }

  // Explicit fields: `currentDesign` must never reach the network.
  const request: EditRequest = { projectId: input.projectId, prompt }
  const body = await postJson(
    config.baseUrl,
    "/api/edit",
    request,
    "edit",
    options.timeoutMs ?? EDIT_TIMEOUT_MS,
    options.signal
  )
  return { ...parseEditResponse(body), summary: "Updated the design." }
}
