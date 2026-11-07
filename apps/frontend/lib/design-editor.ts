import type { WebsiteDesign } from "@/types/website"

/**
 * Prompt-based editing of a WebsiteDesign.
 *
 * This file is the only place that knows how an instruction becomes a new
 * design. It has no React or browser code. Today it matches a few fixed
 * phrases locally. Later, `editWebsiteDesign` can call a backend that uses
 * Amazon Bedrock instead, as long as it keeps this signature and result shape.
 * The UI (PromptEditor, PreviewWorkspace) does not need to change.
 *
 * Contract:
 * - The input design is never mutated. A changed design is a new object, and
 *   every field the instruction did not touch is carried over unchanged.
 * - A command the editor does not understand returns `ok: false`. It never
 *   returns `ok: true` for an edit it did not make.
 */

export type DesignEditResult =
  | {
      ok: true
      /** The updated design. Same content as the input if `changed` is false. */
      design: WebsiteDesign
      /** False when the instruction was understood but the design already matched. */
      changed: boolean
      /** Plain-language description of what happened, safe to show to the user. */
      summary: string
    }
  | {
      ok: false
      /** Plain-language reason, safe to show to the user. */
      error: string
    }

/** Same shape a Bedrock-backed implementation will have. */
export type DesignEditor = (
  design: WebsiteDesign,
  instruction: string
) => Promise<DesignEditResult>

/** Commands the mock understands. Shown in the UI as examples. */
export const DEMO_EDIT_COMMANDS: readonly string[] = [
  "Change the primary color to dark green",
  "Change the hero title to Welcome to Our Cafe",
  "Change the button text to Contact Us",
]

/** Simulated network delay so loading states are visible. Remove with the mock. */
const MOCK_LATENCY_MS = 700

const MAX_INSTRUCTION_LENGTH = 300
const MAX_TEXT_VALUE_LENGTH = 80

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Named colours the mock understands, as "#RRGGBB". */
const NAMED_COLORS: Record<string, string> = {
  "dark green": "#006400",
  green: "#2E7D32",
  "dark blue": "#0B2A5B",
  blue: "#1D4ED8",
  "dark red": "#8B0000",
  red: "#C62828",
  purple: "#6B21A8",
  orange: "#EA580C",
  black: "#111111",
}

const VERB = "(?:please\\s+)?(?:change|set|make|update)"
const CONNECTOR = "(?:to|as|into)"

const PRIMARY_COLOR_COMMAND = new RegExp(
  `^${VERB}\\s+(?:the\\s+)?primary\\s+colou?r\\s+${CONNECTOR}\\s+(.+?)\\s*$`,
  "i"
)
const HERO_TITLE_COMMAND = new RegExp(
  `^${VERB}\\s+(?:the\\s+)?hero\\s+(?:title|headline|heading)\\s+${CONNECTOR}\\s+(.+?)\\s*$`,
  "i"
)
const BUTTON_TEXT_COMMAND = new RegExp(
  `^${VERB}\\s+(?:the\\s+)?(?:hero\\s+)?button\\s+(?:text|label)\\s+${CONNECTOR}\\s+(.+?)\\s*$`,
  "i"
)

/** Removes one pair of matching quotes around a value: "Hello" -> Hello. */
function stripWrappingQuotes(value: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["\u201C", "\u201D"],
    ["\u2018", "\u2019"],
  ]
  for (const [open, close] of pairs) {
    if (value.length >= 2 && value.startsWith(open) && value.endsWith(close)) {
      return value.slice(1, -1).trim()
    }
  }
  return value
}

/** Returns "#RRGGBB" for a colour name or hex code, or null if not understood. */
function parseColor(raw: string): string | null {
  const value = stripWrappingQuotes(raw.trim()).replace(/[.!]+$/, "").trim()

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const digits = hex[1]
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : digits
    return `#${full.toUpperCase()}`
  }

  return NAMED_COLORS[value.toLowerCase().replace(/\s+/g, " ")] ?? null
}

/** Cleans a user-supplied text value, or returns an error message. */
function parseTextValue(
  raw: string,
  what: string
): { ok: true; value: string } | { ok: false; error: string } {
  const value = stripWrappingQuotes(raw.trim())
  if (!value) return { ok: false, error: `The new ${what} cannot be empty.` }
  if (value.length > MAX_TEXT_VALUE_LENGTH) {
    return {
      ok: false,
      error: `The new ${what} is too long. Keep it under ${MAX_TEXT_VALUE_LENGTH} characters.`,
    }
  }
  return { ok: true, value }
}

function unchanged(design: WebsiteDesign, summary: string): DesignEditResult {
  return { ok: true, design, changed: false, summary }
}

function unsupported(instruction: string): DesignEditResult {
  const shown =
    instruction.length > 80 ? `${instruction.slice(0, 80)}...` : instruction
  return {
    ok: false,
    error:
      `Not supported yet: "${shown}". No changes were made. ` +
      `This demo only understands: ${DEMO_EDIT_COMMANDS.map((c) => `"${c}"`).join(", ")}.`,
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Synchronous rule matching. Exported separately from `editWebsiteDesign` so
 * the rules can be checked without the artificial delay.
 */
export function applyMockEdit(
  design: WebsiteDesign,
  instruction: string
): DesignEditResult {
  const text = instruction.trim().replace(/\s+/g, " ")
  if (!text) return { ok: false, error: "Type an instruction first." }
  if (text.length > MAX_INSTRUCTION_LENGTH) {
    return {
      ok: false,
      error: `That instruction is too long. Keep it under ${MAX_INSTRUCTION_LENGTH} characters.`,
    }
  }

  // 1. Primary colour
  const colorMatch = PRIMARY_COLOR_COMMAND.exec(text)
  if (colorMatch) {
    const color = parseColor(colorMatch[1])
    if (!color) {
      return {
        ok: false,
        error:
          `I don't know the color "${colorMatch[1]}". No changes were made. ` +
          `Use a hex code like #0B6E4F or one of: ${Object.keys(NAMED_COLORS).join(", ")}.`,
      }
    }
    if (design.theme.colors.primary.toUpperCase() === color) {
      return unchanged(design, `The primary color is already ${color}.`)
    }
    return {
      ok: true,
      changed: true,
      summary: `Changed the primary color to ${color}.`,
      design: {
        ...design,
        theme: {
          ...design.theme,
          colors: { ...design.theme.colors, primary: color },
        },
      },
    }
  }

  // 2. Hero title
  const titleMatch = HERO_TITLE_COMMAND.exec(text)
  if (titleMatch) {
    const parsed = parseTextValue(titleMatch[1], "hero title")
    if (!parsed.ok) return parsed
    if (design.hero.headline === parsed.value) {
      return unchanged(design, "The hero title already says that.")
    }
    return {
      ok: true,
      changed: true,
      summary: `Changed the hero title to "${parsed.value}".`,
      design: {
        ...design,
        hero: { ...design.hero, headline: parsed.value },
      },
    }
  }

  // 3. Button text. "The button" means the hero's main call-to-action. Its
  // sectionId is kept so the button still scrolls to the same section.
  const buttonMatch = BUTTON_TEXT_COMMAND.exec(text)
  if (buttonMatch) {
    const parsed = parseTextValue(buttonMatch[1], "button text")
    if (!parsed.ok) return parsed
    if (design.hero.primaryCta.label === parsed.value) {
      return unchanged(design, "The hero button already says that.")
    }
    return {
      ok: true,
      changed: true,
      summary: `Changed the hero button text to "${parsed.value}".`,
      design: {
        ...design,
        hero: {
          ...design.hero,
          primaryCta: { ...design.hero.primaryCta, label: parsed.value },
        },
      },
    }
  }

  return unsupported(text)
}

/**
 * Mock of the future "edit this design" backend call (Amazon Bedrock). It
 * applies local rules after a short delay. To switch to the real thing, replace
 * the body with a fetch to the API and return the same `DesignEditResult`.
 */
export const editWebsiteDesign: DesignEditor = async (design, instruction) => {
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS))
  return applyMockEdit(design, instruction)
}
