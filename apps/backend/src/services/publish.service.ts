import { createHash } from "node:crypto";

import type { GeneratedWebsite } from "@siterevive/shared";

/**
 * Packages an AI-written website ({ html, css, javascript }) as one standalone
 * HTML document that can be served to the public or downloaded and hosted
 * anywhere.
 *
 * The page is untrusted code, so it is contained twice:
 *  - A Content-Security-Policy that allows exactly one inline script (by hash)
 *    plus the page's own script, blocks every network API, form submission and
 *    embedded frame, and only lets images/fonts load over http(s)/data.
 *  - When served by SiteRevive, the CSP `sandbox` directive gives the page an
 *    opaque origin, so it can never touch the API's origin.
 *
 * The same rules as the in-app preview apply (see apps/frontend/lib/generated-page.ts).
 */

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishError";
  }
}

export interface PublishedDocument {
  /** The complete document, including a CSP <meta> tag. */
  html: string;
  /** Value for the Content-Security-Policy response header (adds `sandbox`). */
  contentSecurityPolicy: string;
}

export interface PublishOptions {
  businessName: string;
  description?: string;
  /** The original site's address. Relative image URLs resolve against it. */
  baseUrl?: string;
}

function sha256Base64(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

/** http(s) only, no credentials. Anything else is ignored. */
function safeBaseUrl(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;

    return url.href;
  } catch {
    return null;
  }
}

/**
 * Stricter than the generation schema, matching the in-app preview: a
 * <meta http-equiv="refresh"> can redirect visitors and a stray <base> can
 * redirect every link, and a CSP cannot stop either.
 */
function embeddingProblem(website: GeneratedWebsite): string | null {
  const { html, css, javascript } = website;

  if (!html.trim()) return "The website has no HTML.";
  if (/<\s*(script|style|iframe|object|embed)\b/i.test(html)) {
    return "The HTML contains a script, style, iframe, object or embed element.";
  }
  if (/<\s*(meta|base)\b/i.test(html)) {
    return "The HTML contains a meta or base element.";
  }
  if (/\son[a-z]+\s*=/i.test(html)) {
    return "The HTML contains an inline event handler.";
  }
  if (/javascript\s*:/i.test(html)) {
    return "The HTML contains a javascript: URL.";
  }
  if (/<\/style/i.test(css)) return "The CSS contains a closing style tag.";
  if (/@import\b/i.test(css)) return "The CSS uses @import.";
  if (/<\/script/i.test(javascript)) {
    return "The JavaScript contains a closing script tag.";
  }
  // "<!--" inside an inline script can change where the browser thinks the
  // script ends.
  if (javascript.includes("<!--")) {
    return "The JavaScript contains an HTML comment opener.";
  }

  return null;
}

/**
 * Keeps "#section" links scrolling inside the page. Without it, the <base>
 * element would turn them into navigations to the original website.
 */
const ANCHOR_SCRIPT = `
(function () {
  document.addEventListener("click", function (event) {
    var node = event.target;
    var link = node && node.closest ? node.closest("a[href]") : null;
    if (!link) return;
    var href = link.getAttribute("href") || "";
    if (href.charAt(0) !== "#") return;
    event.preventDefault();
    var id = href.slice(1);
    try { id = decodeURIComponent(id); } catch (e) {}
    var target = id ? (document.getElementById(id) || document.getElementsByName(id)[0]) : null;
    if (target) target.scrollIntoView({ behavior: "smooth" });
    else if (!id) window.scrollTo({ top: 0, behavior: "smooth" });
  }, true);
})();
`;

function contentSecurityPolicy(scriptHashes: readonly string[]): string {
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
  ].join("; ");
}

export function buildPublishedDocument(
  website: GeneratedWebsite,
  options: PublishOptions,
): PublishedDocument {
  const problem = embeddingProblem(website);

  if (problem) {
    throw new PublishError(
      `This website can't be published safely. ${problem}`,
    );
  }

  // The text between the tags is exactly what the browser hashes.
  const anchorSource = `\n${ANCHOR_SCRIPT}\n`;
  const pageSource = `\n${website.javascript}\n`;

  const policy = contentSecurityPolicy([
    sha256Base64(anchorSource),
    sha256Base64(pageSource),
  ]);

  const base = safeBaseUrl(options.baseUrl);
  const title = escapeText(options.businessName.trim() || "My website");
  const description = options.description?.replace(/\s+/g, " ").trim();

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${description ? `<meta name="description" content="${escapeAttribute(description.slice(0, 300))}">\n` : ""}${base ? `<base href="${escapeAttribute(base)}">\n` : ""}<style>
${website.css}
</style>
</head>
<body>
${website.html}
<script>${anchorSource}</script>
<script>${pageSource}</script>
</body>
</html>`;

  return {
    html,
    // `sandbox` is honoured only in the header. Without allow-same-origin the
    // page gets an opaque origin; popups are allowed so external links that
    // open in a new tab keep working.
    contentSecurityPolicy: `${policy}; sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox`,
  };
}
