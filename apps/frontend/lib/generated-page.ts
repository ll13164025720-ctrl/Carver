import type { ParseResult } from "@/lib/blueprint-adapter"
import { sha256Base64 } from "@/lib/sha256"
import type { GeneratedPage } from "@/types/website"

/**
 * Validation and safe packaging of an AI-written page ({ html, css, javascript }).
 *
 * The page is untrusted code. Two layers keep it contained:
 *
 * 1. `parseGeneratedPage` checks the shape and refuses output that could break
 *    out of the document built here or that the backend's own schema forbids.
 * 2. `buildPageDocument` + `PAGE_SANDBOX` put the code in an <iframe sandbox>
 *    with a Content-Security-Policy, so even code that passed layer 1 cannot
 *    reach the app (see the comments on each constant).
 *
 * The limits and forbidden constructs mirror GeneratedWebsiteSchema in
 * packages/shared/src/index.ts, which the backend enforces before saving a
 * page. Keeping them identical means the app never rejects a page the backend
 * accepted, and never accepts one the backend would reject. No React, no DOM.
 */

export const MAX_HTML_LENGTH = 120_000
export const MAX_CSS_LENGTH = 120_000
export const MAX_JAVASCRIPT_LENGTH = 40_000
export const MAX_PAGE_LENGTH = 200_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Checks the code strings. Returns a reason (for developers, never shown to
 * users) or null when they may be embedded.
 */
function embeddingProblem(page: GeneratedPage): string | null {
  const { html, css, javascript } = page
  if (!html.trim()) return "The page has no HTML."
  if (html.length > MAX_HTML_LENGTH) return "The HTML is too long."
  if (css.length > MAX_CSS_LENGTH) return "The CSS is too long."
  if (javascript.length > MAX_JAVASCRIPT_LENGTH) return "The JavaScript is too long."
  if (html.length + css.length + javascript.length > MAX_PAGE_LENGTH) {
    return "The page is too large."
  }
  if (/<\s*(script|style|iframe|object|embed)\b/i.test(html)) {
    return "The HTML contains a script, style, iframe, object or embed element."
  }
  // Stricter than the backend's schema, which allows these two. A <meta
  // http-equiv="refresh"> can send the preview to another site, and a stray
  // <base> can redirect every link; the Content-Security-Policy cannot stop
  // either. A page written as "body markup only" never needs them.
  if (/<\s*(meta|base)\b/i.test(html)) return "The HTML contains a meta or base element."
  if (/\son[a-z]+\s*=/i.test(html)) return "The HTML contains an inline event handler."
  if (/javascript\s*:/i.test(html)) return "The HTML contains a javascript: URL."
  if (/<\/style/i.test(css)) return "The CSS contains a closing style tag."
  if (/@import\b/i.test(css)) return "The CSS uses @import."
  if (/<\/script/i.test(javascript)) return "The JavaScript contains a closing script tag."
  // "<!--" inside an inline script can change how the browser finds the end of
  // the script. It does not occur in ordinary code.
  if (javascript.includes("<!--")) return "The JavaScript contains an HTML comment opener."
  return null
}

/**
 * Validates a `website` object from the backend (or from storage) and returns a
 * clean copy. `css` must be a string (it may be empty), and `javascript`
 * defaults to "" like the backend's schema does.
 */
export function parseGeneratedPage(value: unknown): ParseResult<GeneratedPage> {
  if (!isRecord(value)) return { ok: false, error: "The website is not an object." }
  if (typeof value.html !== "string") return { ok: false, error: "The website has no html text." }
  if (typeof value.css !== "string") return { ok: false, error: "The website has no css text." }
  // Like the backend's schema, only a missing field defaults to "" (null is an error).
  const javascript = value.javascript === undefined ? "" : value.javascript
  if (typeof javascript !== "string") {
    return { ok: false, error: "The website javascript is not text." }
  }

  const page: GeneratedPage = { html: value.html, css: value.css, javascript }
  const problem = embeddingProblem(page)
  return problem ? { ok: false, error: problem } : { ok: true, value: page }
}

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

/**
 * The iframe `sandbox` attribute. Only `allow-scripts` is granted, so the page
 * can run its own JavaScript (menus, tabs, sliders) and nothing else.
 *
 * Deliberately NOT granted:
 * - allow-same-origin: without it the frame has an opaque origin. It cannot read
 *   this app's DOM, cookies, localStorage or sessionStorage, and its own
 *   storage and cookie access throws.
 * - allow-top-navigation (and variants): it cannot navigate or replace the app.
 * - allow-popups: window.open and target="_blank" are blocked.
 * - allow-forms: forms cannot submit.
 * - allow-modals: alert, confirm and prompt are blocked.
 * - allow-downloads, allow-pointer-lock, allow-presentation, allow-orientation-lock.
 */
export const PAGE_SANDBOX = "allow-scripts"

/**
 * The Content-Security-Policy placed inside the frame's document.
 * - default-src 'none': nothing loads unless listed below.
 * - script-src with two SHA-256 hashes: only the two inline scripts built here
 *   (the link guard and the generated code) run, exactly as written. A script
 *   added later, an inline event handler, a javascript: URL, `eval`, a string
 *   passed to setTimeout, `import()` and an external script all fail the check.
 *   Hashes are used instead of a nonce on purpose: a nonce can be read from the
 *   script element and reused, which would let a page load third-party code or
 *   inject new scripts. A hash cannot be reused for different code.
 * - style-src 'unsafe-inline': the generated <style> and style="" attributes.
 *   External stylesheets are blocked.
 * - img/font/media https: and data: only: pictures and fonts from the original
 *   site keep working. Known limit: loading a picture is a request to a
 *   server of the page's choosing, so a malicious page could put text in an
 *   image address. That can only carry what the page itself contains, because
 *   the frame cannot read anything from the app (see PAGE_SANDBOX), and the
 *   referrer is withheld so the app's address is not revealed either.
 * - connect-src 'none': no fetch, XMLHttpRequest, WebSocket, EventSource or
 *   sendBeacon, so the page cannot make scripted requests or read answers.
 * - form-action, frame-src, object-src, worker-src, manifest-src 'none'.
 */
export function pageContentSecurityPolicy(scriptHashes: readonly string[]): string {
  for (const hash of scriptHashes) {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(hash)) throw new Error("A script hash is not valid.")
  }
  return [
    "default-src 'none'",
    `script-src ${scriptHashes.map((hash) => `'sha256-${hash}'`).join(" ")}`,
    "style-src 'unsafe-inline'",
    "img-src https: http: data:",
    "font-src https: data:",
    "media-src https: data:",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
  ].join("; ")
}

/** For values placed inside a double-quoted attribute. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/** The address relative URLs in the page resolve against: http(s) only, no credentials. */
export function safeBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

/**
 * Messages the frame may send to the app. Only these two exist, and the app
 * treats both as untrusted display text.
 */
export type FrameMessage = { type: "link"; value: string } | { type: "error"; value: string }

const MESSAGE_SOURCE = "siterevive-preview"

/** Returns a well-formed message from the frame, or null for anything else. */
export function parseFrameMessage(data: unknown): FrameMessage | null {
  if (!isRecord(data) || data.source !== MESSAGE_SOURCE) return null
  if (data.type !== "link" && data.type !== "error") return null
  if (typeof data.value !== "string") return null
  return { type: data.type, value: data.value.replace(/\s+/g, " ").trim().slice(0, 300) }
}

/**
 * Our own script, run before the page's. It makes the preview behave like a
 * standalone page without letting it leave:
 * - "#section" links scroll inside the page. (With a <base> element a plain
 *   "#section" link would otherwise navigate to the original site.)
 * - Every other link is blocked and reported, so the preview never navigates.
 * - Script errors are reported (the app only logs them in development).
 * Messages go only to the app's own origin.
 */
function guardScript(parentOrigin: string): string {
  return `(function () {
  var TARGET = ${JSON.stringify(parentOrigin)};
  function send(type, value) {
    try { parent.postMessage({ source: ${JSON.stringify(MESSAGE_SOURCE)}, type: type, value: String(value).slice(0, 300) }, TARGET); } catch (e) {}
  }
  document.addEventListener("click", function (event) {
    var node = event.target;
    var link = node && node.closest ? node.closest("a[href]") : null;
    if (!link) return;
    var href = link.getAttribute("href") || "";
    event.preventDefault();
    if (href.charAt(0) === "#") {
      var id = href.slice(1);
      try { id = decodeURIComponent(id); } catch (e) {}
      var target = id ? (document.getElementById(id) || document.getElementsByName(id)[0]) : null;
      if (target) target.scrollIntoView({ behavior: "smooth" });
      else if (!id) window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    send("link", link.href || href);
  }, true);
  window.addEventListener("error", function (event) { send("error", event.message); });
})();`
}

export interface PageDocumentOptions {
  /** The captured site's address. Relative URLs in the page resolve against it. */
  baseUrl?: string | null
  /** The app's origin, the only recipient of messages from the frame. */
  parentOrigin: string
}

/**
 * Builds the complete HTML document for the sandboxed iframe's `srcDoc`. It
 * contains exactly two scripts, and the policy allows exactly those by hash.
 * Throws if the page or options are not embeddable; call parseGeneratedPage
 * first to get a clean error instead.
 */
export function buildPageDocument(page: GeneratedPage, options: PageDocumentOptions): string {
  const problem = embeddingProblem(page)
  if (problem) throw new Error(problem)
  const origin = new URL(options.parentOrigin).origin

  // The text between the tags is exactly what the browser hashes, so it is built
  // once and used for both the policy and the document.
  const guardSource = `\n${guardScript(origin)}\n`
  const pageSource = `\n${page.javascript}\n`
  const policy = pageContentSecurityPolicy([sha256Base64(guardSource), sha256Base64(pageSource)])

  const base = safeBaseUrl(options.baseUrl)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
${base ? `<base href="${escapeAttribute(base)}">\n` : ""}<style>
${page.css}
</style>
</head>
<body>
${page.html}
<script>${guardSource}</script>
<script>${pageSource}</script>
</body>
</html>`
}

/**
 * A short fingerprint of the page's code (FNV-1a). Used as a React key so a
 * changed page gets a brand-new frame, never a patched one with stale scripts,
 * timers or listeners.
 */
export function pageContentKey(page: GeneratedPage): string {
  let hash = 0x811c9dc5
  const text = `${page.html}\u0000${page.css}\u0000${page.javascript}`
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${(hash >>> 0).toString(16)}-${text.length}`
}
