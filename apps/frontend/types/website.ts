/**
 * Data contract for a redesigned website.
 *
 * Everything here is plain, JSON-serialisable data (strings, numbers, booleans,
 * arrays, objects). There are no functions, Dates, HTML, CSS or script strings,
 * so the same shapes can later be returned by a backend as JSON.
 *
 * Rendering rules for consumers:
 * - Treat every string as untrusted text. Render it as text, never as HTML.
 * - Only render image and link URLs that use http: or https:.
 * - Map fonts and colours to an allow-list or validate them before using them
 *   in styles.
 * - Optional fields are omitted when absent (never `null`).
 */

import type { WebsiteBlueprint, WebsiteCapture } from "@/types/backend"

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

export interface ImageAsset {
  /** Absolute http(s) URL. */
  src: string
  /** Text alternative. Required for accessibility. */
  alt: string
  width?: number
  height?: number
}

/**
 * A call to action that scrolls to a section on the same page.
 * `sectionId` must match the `id` of an entry in `WebsiteDesign.sections`.
 */
export interface SectionLink {
  label: string
  sectionId: string
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/** Colours are hex strings in the form "#RRGGBB". */
export interface ThemeColors {
  primary: string
  secondary: string
  accent: string
  background: string
  surface: string
  text: string
  mutedText: string
}

export interface ThemeTypography {
  /** Font family name, e.g. "Playfair Display". */
  headingFont: string
  bodyFont: string
  scale: "compact" | "comfortable" | "spacious"
}

export interface WebsiteTheme {
  colors: ThemeColors
  typography: ThemeTypography
}

// ---------------------------------------------------------------------------
// Content blocks (one per section type)
// ---------------------------------------------------------------------------

export interface NavigationContent {
  items: SectionLink[]
  cta?: SectionLink
}

export interface HeroContent {
  headline: string
  subheadline: string
  primaryCta: SectionLink
  secondaryCta?: SectionLink
  image: ImageAsset
}

export interface AboutHighlight {
  label: string
  value: string
}

export interface AboutContent {
  heading: string
  /** One entry per paragraph. */
  body: string[]
  highlights: AboutHighlight[]
  image?: ImageAsset
}

export interface ServiceItem {
  id: string
  name: string
  description: string
  /** Display text, e.g. "From $4.50". Not a number, so currencies stay flexible. */
  price?: string
  image?: ImageAsset
}

export interface ServicesContent {
  heading: string
  intro?: string
  items: ServiceItem[]
}

export interface GalleryImage extends ImageAsset {
  id: string
  caption?: string
}

export interface GalleryContent {
  heading: string
  images: GalleryImage[]
}

export interface PostalAddress {
  street: string
  city: string
  region: string
  postalCode: string
  country: string
}

export interface OpeningHours {
  /** e.g. "Monday to Friday" */
  days: string
  /** e.g. "7:00 AM - 5:00 PM", or "Closed" */
  hours: string
}

export interface ContactContent {
  heading: string
  intro?: string
  address: PostalAddress
  phone: string
  email: string
  openingHours: OpeningHours[]
}

export type SocialPlatform =
  | "instagram"
  | "facebook"
  | "x"
  | "tiktok"
  | "yelp"
  | "linkedin"
  | "youtube"

export interface SocialLink {
  platform: SocialPlatform
  /** Absolute http(s) URL. */
  url: string
}

export interface FooterContent {
  tagline?: string
  links: SectionLink[]
  socialLinks: SocialLink[]
  /** Plain legal line, e.g. "All rights reserved." */
  legalText: string
}

// ---------------------------------------------------------------------------
// Sections (ordering and visibility, for dynamic rendering)
// ---------------------------------------------------------------------------

/** Section types that appear in the page body, between navigation and footer. */
export type SectionType = "hero" | "about" | "services" | "gallery" | "contact"

/**
 * One entry per rendered section, in page order. The renderer walks this list
 * and looks up the content for `type` on the design (`design.hero`,
 * `design.about`, ...). Reordering or hiding a section only changes this list.
 */
export interface SectionConfig {
  /** Unique within the design. Used as the anchor target for navigation. */
  id: string
  type: SectionType
  visible: boolean
}

// ---------------------------------------------------------------------------
// The full design
// ---------------------------------------------------------------------------

export interface WebsiteDesign {
  /** Bump (e.g. to `1 | 2`) when the shape changes in a breaking way. */
  schemaVersion: 1
  businessName: string
  tagline?: string
  theme: WebsiteTheme
  navigation: NavigationContent
  hero: HeroContent
  about: AboutContent
  services: ServicesContent
  gallery: GalleryContent
  contact: ContactContent
  footer: FooterContent
  sections: SectionConfig[]
}

// ---------------------------------------------------------------------------
// Redesign result
// ---------------------------------------------------------------------------

/** What a redesign request returns. */
export interface RedesignResult {
  projectId: string
  /**
   * Screenshot of the original site: an absolute http(s) URL or a site-relative
   * path. Empty when the backend returned a screenshot path that cannot be
   * turned into a URL (the "Before" pane then shows a text placeholder).
   */
  originalScreenshotUrl: string
  design: WebsiteDesign
  /**
   * Real backend only (absent for the built-in sample). The backend's own
   * description of the site. `design` is derived from it, and prompt edits send
   * it back to the backend, so it must be kept alongside the design.
   */
  blueprint?: WebsiteBlueprint
  /**
   * Real backend only. The page capture the blueprint was made from, kept so the
   * design can be rebuilt after an edit (hero photo, gallery, social links).
   * Its long `text` and `headings` are emptied to keep storage small.
   */
  capture?: WebsiteCapture
}
