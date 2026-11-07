import type { CSSProperties } from "react"

import type { ThemeColors, WebsiteTheme } from "@/types/website"

/**
 * Helpers for turning a WebsiteDesign into safe markup and styles.
 * A design is JSON that will eventually come from a backend, so every value
 * that reaches a style or a link is validated or checked against an allow-list.
 */

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value)
}

/** Neutral fallbacks, used when a colour in the design is missing or invalid. */
const FALLBACK_COLORS: ThemeColors = {
  primary: "#1F2937",
  secondary: "#374151",
  accent: "#6366F1",
  background: "#FFFFFF",
  surface: "#F9FAFB",
  text: "#111827",
  mutedText: "#6B7280",
}

function channelToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const r = channelToLinear(parseInt(hex.slice(1, 3), 16))
  const g = channelToLinear(parseInt(hex.slice(3, 5), 16))
  const b = channelToLinear(parseInt(hex.slice(5, 7), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const DARK_TEXT = "#111111"
const LIGHT_TEXT = "#FFFFFF"

/** Picks black or white text, whichever has more contrast on `backgroundHex`. */
export function readableTextOn(backgroundHex: string): string {
  const luminance = relativeLuminance(backgroundHex)
  const contrastWithWhite = 1.05 / (luminance + 0.05)
  const contrastWithBlack = (luminance + 0.05) / (relativeLuminance(DARK_TEXT) + 0.05)
  return contrastWithWhite >= contrastWithBlack ? LIGHT_TEXT : DARK_TEXT
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const SERIF = 'Georgia, "Times New Roman", serif'
// --font-geist-sans is loaded in app/layout.tsx.
const SANS =
  'var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/**
 * Allow-list of font names a design may request. A requested font that is not
 * installed falls back to a generic family of the same style. Only these exact
 * strings can reach the `font-family` property.
 */
const FONT_STACKS: Record<string, string> = {
  "playfair display": `"Playfair Display", ${SERIF}`,
  lora: `"Lora", ${SERIF}`,
  merriweather: `"Merriweather", ${SERIF}`,
  "cormorant garamond": `"Cormorant Garamond", ${SERIF}`,
  "dm serif display": `"DM Serif Display", ${SERIF}`,
  georgia: SERIF,
  "times new roman": SERIF,
  inter: `"Inter", ${SANS}`,
  poppins: `"Poppins", ${SANS}`,
  montserrat: `"Montserrat", ${SANS}`,
  roboto: `"Roboto", ${SANS}`,
  "open sans": `"Open Sans", ${SANS}`,
  lato: `"Lato", ${SANS}`,
  nunito: `"Nunito", ${SANS}`,
  "work sans": `"Work Sans", ${SANS}`,
  "dm sans": `"DM Sans", ${SANS}`,
  geist: SANS,
  helvetica: SANS,
  arial: SANS,
  "jetbrains mono": `"JetBrains Mono", ${MONO}`,
  "space mono": `"Space Mono", ${MONO}`,
}

export function fontStack(name: unknown): string {
  if (typeof name !== "string") return SANS
  return FONT_STACKS[name.trim().toLowerCase()] ?? SANS
}

// ---------------------------------------------------------------------------
// Theme -> CSS custom properties
// ---------------------------------------------------------------------------

/** Vertical rhythm for each `typography.scale` value (container-query aware). */
export const SECTION_PADDING: Record<WebsiteTheme["typography"]["scale"], string> = {
  compact: "py-12 @2xl:py-16",
  comfortable: "py-16 @2xl:py-24",
  spacious: "py-20 @2xl:py-32",
}

export function sectionPaddingFor(scale: unknown): string {
  return typeof scale === "string" && scale in SECTION_PADDING
    ? SECTION_PADDING[scale as keyof typeof SECTION_PADDING]
    : SECTION_PADDING.comfortable
}

/**
 * Converts a theme into CSS custom properties (`--sr-*`) that the section
 * components read. Invalid colours are replaced by neutral fallbacks.
 */
export function buildThemeStyle(theme: WebsiteTheme): CSSProperties {
  const pick = (key: keyof ThemeColors): string =>
    isHexColor(theme?.colors?.[key]) ? theme.colors[key] : FALLBACK_COLORS[key]

  const primary = pick("primary")
  const secondary = pick("secondary")
  const accent = pick("accent")
  const background = pick("background")
  const text = pick("text")

  const vars: Record<string, string> = {
    "--sr-primary": primary,
    "--sr-on-primary": readableTextOn(primary),
    "--sr-secondary": secondary,
    "--sr-on-secondary": readableTextOn(secondary),
    "--sr-accent": accent,
    "--sr-on-accent": readableTextOn(accent),
    "--sr-bg": background,
    "--sr-surface": pick("surface"),
    "--sr-text": text,
    "--sr-muted": pick("mutedText"),
    // 12% opacity version of the text colour, for hairlines and borders.
    "--sr-border": `${text}1F`,
    "--sr-heading-font": fontStack(theme?.typography?.headingFont),
    "--sr-body-font": fontStack(theme?.typography?.bodyFont),
  }
  return vars as CSSProperties
}

// ---------------------------------------------------------------------------
// URLs and contact links
// ---------------------------------------------------------------------------

/**
 * True for absolute http(s) URLs and for site-relative paths ("/samples/a.svg").
 * Rejects javascript:, data:, protocol-relative ("//host") and everything else.
 */
export function isSafeImageSrc(src: unknown): src is string {
  if (typeof src !== "string" || !src) return false
  if (src.startsWith("/")) return !src.startsWith("//") && !src.startsWith("/\\")
  try {
    const { protocol } = new URL(src)
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

/** Returns the URL if it is absolute http(s), otherwise null. */
export function safeExternalHref(url: unknown): string | null {
  if (typeof url !== "string") return null
  try {
    const { protocol, href } = new URL(url)
    return protocol === "http:" || protocol === "https:" ? href : null
  } catch {
    return null
  }
}

/** Builds a tel: link from a display phone number, or null if it has too few digits. */
export function telHref(phone: unknown): string | null {
  if (typeof phone !== "string") return null
  const cleaned = phone.replace(/[^\d+]/g, "")
  return cleaned.replace(/\D/g, "").length >= 5 ? `tel:${cleaned}` : null
}

/** Builds a mailto: link, or null if the value does not look like an email address. */
export function mailHref(email: unknown): string | null {
  if (typeof email !== "string") return null
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)
    ? `mailto:${email}`
    : null
}
