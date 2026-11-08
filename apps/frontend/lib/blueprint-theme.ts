import { isHexColor } from "@/lib/website-render"
import type { WebsiteTheme } from "@/types/website"

/**
 * Turns the backend's small theme (two colours and one font) into the full
 * WebsiteTheme the renderer needs (seven colours and a heading/body font pair).
 *
 * The brand colours are kept exactly as the backend sent them. The remaining
 * colours are derived from them, and the text colours are checked for
 * readable contrast so a model-chosen palette cannot make the preview
 * unreadable. This file has no React or browser code.
 */

const FALLBACK_PRIMARY = "#1F2937"
const FALLBACK_SECONDARY = "#374151"
const FALLBACK_TEXT = "#111827"
const WHITE = "#FFFFFF"
const BLACK = "#000000"
const DEFAULT_FONT = "Inter"

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number]

function toRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function toHex([r, g, b]: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0")
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

/** Blends `from` towards `to`. `amount` 0 returns `from`, 1 returns `to`. */
export function mixColors(from: string, to: string, amount: number): string {
  const a = toRgb(from)
  const b = toRgb(to)
  return toHex([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ])
}

function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG contrast ratio between two "#RRGGBB" colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** "#rrggbb" in any case becomes "#RRGGBB". Anything else returns null. */
function normalizeHex(value: unknown): string | null {
  return isHexColor(value) ? value.toUpperCase() : null
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/**
 * Fonts the renderer has a stack for (see FONT_STACKS in lib/website-render.ts),
 * minus the ones that only map to the default sans-serif. Keep in sync: a test
 * fails if a font listed here is unknown to the renderer.
 */
export const SUPPORTED_FONTS: readonly string[] = [
  "Playfair Display",
  "Lora",
  "Merriweather",
  "Cormorant Garamond",
  "DM Serif Display",
  "Georgia",
  "Times New Roman",
  "Inter",
  "Poppins",
  "Montserrat",
  "Roboto",
  "Open Sans",
  "Lato",
  "Nunito",
  "Work Sans",
  "DM Sans",
  "JetBrains Mono",
  "Space Mono",
]

const SERIF_FONTS = new Set(
  [
    "Playfair Display",
    "Lora",
    "Merriweather",
    "Cormorant Garamond",
    "DM Serif Display",
    "Georgia",
    "Times New Roman",
  ].map((name) => name.toLowerCase())
)

const CANONICAL_FONT = new Map(
  SUPPORTED_FONTS.map((name) => [name.toLowerCase(), name] as const)
)

/**
 * Picks a font pair for one backend font name. "'Lora', serif" and "lora" both
 * resolve to Lora. A serif is used for headings with a sans-serif body, any
 * other font is used for both. An unknown or missing font becomes Inter.
 */
export function deriveFonts(fontFamily: unknown): {
  headingFont: string
  bodyFont: string
} {
  const first =
    typeof fontFamily === "string"
      ? fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase()
      : ""
  const font = CANONICAL_FONT.get(first)
  if (!font) return { headingFont: DEFAULT_FONT, bodyFont: DEFAULT_FONT }
  return SERIF_FONTS.has(first)
    ? { headingFont: font, bodyFont: DEFAULT_FONT }
    : { headingFont: font, bodyFont: font }
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/** Minimum contrast for body text (WCAG AAA) and for muted text (WCAG AA). */
const TEXT_CONTRAST = 7
const MUTED_CONTRAST = 4.5
/** The accent must be visibly different from the page background. */
const ACCENT_CONTRAST = 1.5

function pickText(primary: string, background: string): string {
  const candidate = mixColors(primary, BLACK, 0.8)
  return contrastRatio(candidate, background) >= TEXT_CONTRAST
    ? candidate
    : FALLBACK_TEXT
}

function pickMutedText(text: string, background: string): string {
  for (const amount of [0.45, 0.35, 0.25, 0.15]) {
    const candidate = mixColors(text, background, amount)
    if (
      contrastRatio(candidate, background) >= MUTED_CONTRAST &&
      contrastRatio(candidate, WHITE) >= MUTED_CONTRAST
    ) {
      return candidate
    }
  }
  return text
}

export interface BlueprintThemeInput {
  primaryColor?: unknown
  secondaryColor?: unknown
  fontFamily?: unknown
}

/**
 * Builds the full theme. Never throws: an invalid or missing colour is replaced
 * by a neutral fallback.
 */
export function deriveTheme(input: BlueprintThemeInput): WebsiteTheme {
  const primary = normalizeHex(input.primaryColor) ?? FALLBACK_PRIMARY
  const secondary = normalizeHex(input.secondaryColor) ?? FALLBACK_SECONDARY

  // A soft tint of the brand colour keeps the page on-palette without being
  // white. Cards sit on pure white.
  const background = mixColors(primary, WHITE, 0.95)
  const text = pickText(primary, background)
  const accent =
    contrastRatio(secondary, background) >= ACCENT_CONTRAST ? secondary : primary

  return {
    colors: {
      primary,
      secondary,
      accent,
      background,
      surface: WHITE,
      text,
      mutedText: pickMutedText(text, background),
    },
    typography: { ...deriveFonts(input.fontFamily), scale: "comfortable" },
  }
}
