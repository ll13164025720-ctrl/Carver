/**
 * Guesses a business name from a captured page.
 *
 * POST /api/blueprints/generate requires a `businessName`, but the user only
 * gave us a URL. The page <title> usually holds the name next to a slogan or a
 * word like "Home" ("Home | Joe's Café", "Joe's Café - Best Coffee in Town").
 * This picks the most likely part and falls back to the domain name. It is a
 * guess: the generated site shows the name it is given.
 */

const MAX_LENGTH = 120
const FALLBACK = "My Business"

/** Title parts that never name a business. */
const GENERIC_PART =
  /^(?:home(?:page)?|welcome(?: to)?|official(?: web)?site|index|untitled|main(?: page)?|website|web site)$/i

/** Splits "A | B", "A - B", "A – B", "A · B", "A: B". A hyphen inside a word is kept. */
const TITLE_SEPARATOR = /\s+[-–—:]\s+|\s*[|·•]\s*/

const SECOND_LEVEL_LABELS = new Set(["co", "com", "org", "net", "ac", "gov", "edu"])

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function alphanumeric(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "")
}

function limit(value: string): string {
  const characters = Array.from(value)
  return characters.length <= MAX_LENGTH
    ? value
    : characters.slice(0, MAX_LENGTH).join("").trimEnd()
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** "www.joes-cafe.co.uk" becomes "Joes Cafe". Returns "" if there is no usable label. */
function nameFromHostname(hostname: string): string {
  const labels = hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean)
  if (labels.length < 2) return ""

  const last = labels[labels.length - 1]
  const hasCompoundSuffix =
    labels.length >= 3 &&
    last.length === 2 &&
    SECOND_LEVEL_LABELS.has(labels[labels.length - 2])
  const label = labels[labels.length - (hasCompoundSuffix ? 3 : 2)]

  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map(titleCase)
    .join(" ")
}

function hostnameOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname
  } catch {
    return ""
  }
}

/**
 * @param title    The page title from the capture (may be empty).
 * @param pageUrl  The page address, used when the title is no help.
 * @returns        A non-empty name of at most 120 characters.
 */
export function deriveBusinessName(title: unknown, pageUrl: string): string {
  const hostname = hostnameOf(pageUrl)
  const hostKey = alphanumeric(nameFromHostname(hostname))

  const parts = (typeof title === "string" ? squash(title) : "")
    .split(TITLE_SEPARATOR)
    .map(squash)
    .filter((part) => part.length >= 2 && !GENERIC_PART.test(part) && /[^\d\s]/.test(part))

  if (parts.length > 0) {
    // A part that matches the domain ("Joe's Café" for joescafe.com) is almost
    // certainly the business. Otherwise the shortest part, since slogans are long.
    const matching = hostKey
      ? parts.find((part) => {
          const key = alphanumeric(part)
          return key.length >= 3 && (key.includes(hostKey) || hostKey.includes(key))
        })
      : undefined
    const shortest = [...parts].sort((a, b) => a.length - b.length)[0]
    return limit(matching ?? shortest)
  }

  return limit(nameFromHostname(hostname) || FALLBACK)
}
