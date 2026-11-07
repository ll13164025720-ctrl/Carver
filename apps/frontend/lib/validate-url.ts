export type UrlValidationResult =
  | { ok: true; url: string; hostname: string }
  | { ok: false; error: string }

const MAX_URL_LENGTH = 2048

// "https://", "ftp://", ... (an explicit scheme followed by //)
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
// "mailto:", "javascript:", "tel:", ... A colon followed by a digit is a port
// ("example.com:8080"), so it is not treated as a scheme.
const OPAQUE_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
// Alphabetic TLD (".com") or punycode TLD (internationalised domains).
const HOST_TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

const MESSAGES = {
  empty: "Enter your website address to get started.",
  tooLong: "That address is too long. Please use a shorter URL.",
  spaces: "Web addresses can't contain spaces.",
  scheme: "Only http:// and https:// addresses are supported.",
  credentials: "Remove the username and password from the address.",
  invalid:
    "That doesn't look like a valid website address. Try something like https://example.com.",
} as const

function fail(error: string): UrlValidationResult {
  return { ok: false, error }
}

function isPublicHostname(hostname: string): boolean {
  const labels = hostname.replace(/\.$/, "").split(".")
  if (labels.length < 2) return false // rejects "localhost" and bare words
  if (!labels.every((label) => HOST_LABEL.test(label))) return false
  return HOST_TLD.test(labels[labels.length - 1])
}

/**
 * Validates a website address typed by a user.
 *
 * - Accepts http:// and https:// URLs.
 * - Accepts an address without a scheme ("mybakery.com") and assumes https://.
 * - Rejects other schemes, spaces, embedded credentials, localhost and IP addresses.
 *
 * This is a UX check only. Any backend that fetches the URL must validate it again.
 */
export function validateWebsiteUrl(input: string): UrlValidationResult {
  const value = input.trim()

  if (!value) return fail(MESSAGES.empty)
  if (value.length > MAX_URL_LENGTH) return fail(MESSAGES.tooLong)
  if (/\s/.test(value)) return fail(MESSAGES.spaces)

  const hasExplicitScheme = EXPLICIT_SCHEME.test(value)
  if (!hasExplicitScheme && OPAQUE_SCHEME.test(value)) {
    // "http:/example.com" is a typo for a supported scheme, not an unsupported one.
    return fail(/^https?:/i.test(value) ? MESSAGES.invalid : MESSAGES.scheme)
  }

  let parsed: URL
  try {
    parsed = new URL(hasExplicitScheme ? value : `https://${value}`)
  } catch {
    return fail(MESSAGES.invalid)
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail(MESSAGES.scheme)
  }
  if (parsed.username || parsed.password) return fail(MESSAGES.credentials)
  if (!isPublicHostname(parsed.hostname)) return fail(MESSAGES.invalid)

  return { ok: true, url: parsed.toString(), hostname: parsed.hostname }
}
