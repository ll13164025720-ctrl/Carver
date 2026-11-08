import { deriveTheme } from "@/lib/blueprint-theme"
import { isHexColor, safeExternalHref } from "@/lib/website-render"
import type {
  BlueprintSection,
  BlueprintSectionType,
  WebsiteBlueprint,
  WebsiteCapture,
} from "@/types/backend"
import type {
  AboutContent,
  ContactContent,
  FooterContent,
  GalleryContent,
  GalleryImage,
  HeroContent,
  ImageAsset,
  NavigationContent,
  OpeningHours,
  PostalAddress,
  SectionConfig,
  SectionLink,
  SectionType,
  ServiceItem,
  ServicesContent,
  SocialLink,
  SocialPlatform,
  WebsiteDesign,
} from "@/types/website"

/**
 * Converts the backend's WebsiteBlueprint (plus the page capture it was made
 * from) into the WebsiteDesign the renderer draws.
 *
 * Why this is a separate, defensive layer:
 * - A blueprint's section `content` is free-form. The backend checks that it
 *   is an object, nothing more. A model can leave fields empty (the prompt
 *   forbids inventing addresses, prices and so on), omit them, or use the wrong
 *   type, and a prompt edit can overwrite a whole field with any JSON value.
 * - The renderer expects every field of WebsiteDesign to exist.
 *
 * So every read here is type-checked, every string is cleaned and length
 * limited, every URL is checked for http(s), and every gap gets a safe default.
 * `blueprintToDesign` never throws and always returns a design that the
 * renderer can draw. Nothing is invented: when the backend gave no value, the
 * field is empty and the section is hidden if it would be an empty shell.
 *
 * The blueprint stays the source of truth. The design is derived from it every
 * time, so a prompt edit sends the blueprint back to the backend and converts
 * the result again.
 *
 * Browser and server safe: no React, no DOM, no network.
 */

// ---------------------------------------------------------------------------
// Parsing network data
// ---------------------------------------------------------------------------

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value })
const fail = <T>(error: string): ParseResult<T> => ({ ok: false, error })

const BLUEPRINT_SECTION_TYPES: ReadonlySet<string> = new Set<BlueprintSectionType>([
  "header",
  "hero",
  "about",
  "menu",
  "contact",
  "footer",
])
const SLUG = /^[a-z0-9-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringWithin(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max
}

/**
 * Checks a value against the backend's blueprint rules (packages/shared) and
 * returns a clean copy. The copy is what gets stored and sent back to the
 * backend for edits, so it must satisfy the same rules the backend enforces:
 * a blueprint that passes here will not be rejected by /api/blueprints/edit
 * for its shape. A missing `description` or `visible` is filled with the
 * backend's own default.
 */
export function parseBlueprint(value: unknown): ParseResult<WebsiteBlueprint> {
  if (!isRecord(value)) return fail("The blueprint is not an object.")
  if (value.schemaVersion !== "1.0") {
    return fail('The blueprint schemaVersion is not "1.0".')
  }
  if (!isStringWithin(value.siteId, 1, 100)) return fail("The blueprint siteId is invalid.")
  if (!isStringWithin(value.slug, 1, 80) || !SLUG.test(value.slug)) {
    return fail("The blueprint slug is invalid.")
  }
  if (!isStringWithin(value.businessName, 1, 120)) {
    return fail("The blueprint businessName is invalid.")
  }
  const description = value.description ?? ""
  if (!isStringWithin(description, 0, 500)) {
    return fail("The blueprint description is invalid.")
  }

  const { theme } = value
  if (
    !isRecord(theme) ||
    !isHexColor(theme.primaryColor) ||
    !isHexColor(theme.secondaryColor) ||
    !isStringWithin(theme.fontFamily, 1, 80)
  ) {
    return fail("The blueprint theme is invalid.")
  }

  const { sections } = value
  if (!Array.isArray(sections) || sections.length < 3 || sections.length > 12) {
    return fail("The blueprint must have 3 to 12 sections.")
  }

  const parsedSections: BlueprintSection[] = []
  for (const [index, section] of sections.entries()) {
    if (
      !isRecord(section) ||
      !isStringWithin(section.id, 1, 80) ||
      typeof section.type !== "string" ||
      !BLUEPRINT_SECTION_TYPES.has(section.type) ||
      (section.visible !== undefined && typeof section.visible !== "boolean") ||
      !isRecord(section.content)
    ) {
      return fail(`Blueprint section ${index + 1} is invalid.`)
    }
    let content: Record<string, unknown>
    try {
      content = structuredClone(section.content)
    } catch {
      return fail(`Blueprint section ${index + 1} contains data that is not plain JSON.`)
    }
    parsedSections.push({
      id: section.id,
      type: section.type as BlueprintSectionType,
      visible: section.visible ?? true,
      content,
    })
  }

  return ok({
    schemaVersion: "1.0",
    siteId: value.siteId,
    slug: value.slug,
    businessName: value.businessName,
    description,
    theme: {
      primaryColor: theme.primaryColor,
      secondaryColor: theme.secondaryColor,
      fontFamily: theme.fontFamily,
    },
    sections: parsedSections,
  })
}

/**
 * Checks a capture from /api/captures. It is lenient on purpose: the capture
 * only adds screenshots, images and social links. It is rejected only when the
 * parts that cannot be defaulted (id and desktop screenshot) are missing.
 * Malformed list entries are dropped rather than failing the whole capture.
 */
export function parseCapture(value: unknown): ParseResult<WebsiteCapture> {
  if (!isRecord(value)) return fail("The capture is not an object.")
  if (typeof value.captureId !== "string" || !value.captureId) {
    return fail("The capture has no captureId.")
  }
  const { screenshots } = value
  if (
    !isRecord(screenshots) ||
    typeof screenshots.desktop !== "string" ||
    !screenshots.desktop
  ) {
    return fail("The capture has no desktop screenshot.")
  }

  const text = (field: unknown) => (typeof field === "string" ? field : "")
  const list = (field: unknown): unknown[] => (Array.isArray(field) ? field : [])

  return ok({
    captureId: value.captureId,
    sourceUrl: text(value.sourceUrl),
    finalUrl: text(value.finalUrl),
    capturedAt: text(value.capturedAt),
    title: text(value.title),
    description: text(value.description),
    headings: list(value.headings).flatMap((entry) =>
      isRecord(entry) && typeof entry.text === "string"
        ? [{ level: typeof entry.level === "number" ? entry.level : 2, text: entry.text }]
        : []
    ),
    text: text(value.text),
    links: list(value.links).flatMap((entry) =>
      isRecord(entry) && typeof entry.url === "string"
        ? [{ text: text(entry.text), url: entry.url }]
        : []
    ),
    images: list(value.images).flatMap((entry) =>
      isRecord(entry) && typeof entry.src === "string"
        ? [{ src: entry.src, alt: text(entry.alt) }]
        : []
    ),
    screenshots: {
      desktop: screenshots.desktop,
      mobile: text(screenshots.mobile),
    },
  })
}

// ---------------------------------------------------------------------------
// Text helpers (all untrusted input goes through these)
// ---------------------------------------------------------------------------

// Control characters, zero-width characters and bidirectional overrides. The
// latter can make text display differently from how it reads.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g

/**
 * A single line of plain text: strings and finite numbers only, whitespace
 * collapsed, invisible characters removed, cut to `max` characters with an
 * ellipsis. Anything else (null, objects, arrays) is an empty string.
 */
function clean(value: unknown, max: number): string {
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : ""
  const text = raw.replace(INVISIBLE, "").replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  const characters = Array.from(text)
  return characters.length <= max
    ? text
    : `${characters.slice(0, max - 1).join("").trimEnd()}…`
}

/** The first non-empty cleaned value among `keys` of `source`. */
function firstText(
  source: Record<string, unknown>,
  keys: readonly string[],
  max: number
): string {
  for (const key of keys) {
    const text = clean(source[key], max)
    if (text) return text
  }
  return ""
}

const MAX_PARAGRAPHS = 8
const MAX_PARAGRAPH_LENGTH = 1200

/** Paragraphs from a string (split on blank lines) or from an array of strings. */
function paragraphs(value: unknown): string[] {
  const parts: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n\s*\r?\n/)
      : []
  return parts
    .map((part) => clean(part, MAX_PARAGRAPH_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_PARAGRAPHS)
}

/** An absolute http(s) URL from a string, or from an object with `src`/`url`. */
function imageUrlOf(value: unknown): string | null {
  if (typeof value === "string") return safeExternalHref(value.trim())
  if (isRecord(value)) {
    return safeExternalHref(
      typeof value.src === "string" ? value.src.trim() : value.url
    )
  }
  return null
}

function firstImageUrl(
  source: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const url = imageUrlOf(source[key])
    if (url) return url
  }
  return null
}

// ---------------------------------------------------------------------------
// Capture images and social links
// ---------------------------------------------------------------------------

/** Words that mark a URL as chrome (logos, icons, tracking pixels), not content. */
const NON_CONTENT_IMAGE = /logo|icon|sprite|pixel|spacer|blank|favicon|badge|avatar|emoji|tracking|1x1/i
const NON_PHOTO_EXTENSION = /\.(?:svg|ico)$/i

interface CaptureImage {
  src: string
  alt: string
}

/**
 * Photos worth showing from the original site: absolute http(s) URLs only,
 * no duplicates, and no obvious logos, icons, SVGs or tracking pixels. This is
 * a guess from the URL alone (the capture has no image sizes), so it is
 * deliberately conservative.
 */
function usableImages(capture: WebsiteCapture | null | undefined): CaptureImage[] {
  if (!capture || !Array.isArray(capture.images)) return []
  const seen = new Set<string>()
  const images: CaptureImage[] = []
  for (const image of capture.images) {
    if (!isRecord(image)) continue
    const src = safeExternalHref(typeof image.src === "string" ? image.src.trim() : null)
    if (!src || seen.has(src)) continue
    const { pathname } = new URL(src)
    if (NON_PHOTO_EXTENSION.test(pathname) || NON_CONTENT_IMAGE.test(pathname)) continue
    seen.add(src)
    images.push({ src, alt: clean(image.alt, 200) })
  }
  return images
}

const SOCIAL_HOSTS: ReadonlyArray<readonly [SocialPlatform, RegExp]> = [
  ["instagram", /(?:^|\.)instagram\.com$/],
  ["facebook", /(?:^|\.)(?:facebook|fb)\.com$/],
  ["x", /(?:^|\.)(?:twitter|x)\.com$/],
  ["tiktok", /(?:^|\.)tiktok\.com$/],
  ["yelp", /(?:^|\.)yelp\.com$/],
  ["linkedin", /(?:^|\.)linkedin\.com$/],
  ["youtube", /(?:^|\.)(?:youtube\.com|youtu\.be)$/],
]
const SOCIAL_NON_PROFILE_PATH = /share|sharer|intent|login|dialog|plugins/i

/**
 * The original site's own links to social profiles, one per platform. Links
 * to a platform's home page or to share/login dialogs are skipped.
 */
function socialLinksFrom(capture: WebsiteCapture | null | undefined): SocialLink[] {
  if (!capture || !Array.isArray(capture.links)) return []
  const found = new Map<SocialPlatform, string>()
  for (const link of capture.links) {
    if (!isRecord(link)) continue
    const href = safeExternalHref(typeof link.url === "string" ? link.url.trim() : null)
    if (!href) continue
    const { hostname, pathname } = new URL(href)
    if (pathname.length <= 1 || SOCIAL_NON_PROFILE_PATH.test(pathname)) continue
    const match = SOCIAL_HOSTS.find(([, pattern]) => pattern.test(hostname.toLowerCase()))
    if (match && !found.has(match[0])) found.set(match[0], href)
  }
  return Array.from(found, ([platform, url]) => ({ platform, url }))
}

// ---------------------------------------------------------------------------
// Section targets (navigation and buttons)
// ---------------------------------------------------------------------------

/** Which design section a blueprint section type is drawn as. */
const DESIGN_TYPE: Partial<Record<BlueprintSectionType, SectionType>> = {
  hero: "hero",
  about: "about",
  menu: "services",
  contact: "contact",
}

/** First match wins, so the order matters. */
const TARGET_KEYWORDS: ReadonlyArray<readonly [SectionType, RegExp]> = [
  ["contact", /\b(?:contact|visit|find us|location|hours|reach|reserve|book|call|directions|address|get in touch)\b/i],
  ["about", /\b(?:about|story|who we are|team|history)\b/i],
  ["gallery", /\b(?:gallery|photos?|portfolio|images?)\b/i],
  ["services", /\b(?:menu|services?|products?|offerings?|shop|pricing|prices|order|food|drinks?|catalog)\b/i],
  ["hero", /\b(?:home|top|welcome)\b/i],
]

function targetFromText(text: string): SectionType | null {
  const normalized = text.replace(/[-_]+/g, " ")
  return TARGET_KEYWORDS.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null
}

/**
 * Which section an in-page link ("#contact", "#contact-main") points at. Links
 * to other pages or sites have no equivalent in a one-page design, so they
 * return null.
 */
function targetFromHref(
  href: string,
  blueprint: WebsiteBlueprint
): SectionType | null {
  const value = href.trim()
  if (value.startsWith("#")) {
    const fragment = value.slice(1)
    const byId = blueprint.sections.find((section) => section.id === fragment)
    const type = byId ? DESIGN_TYPE[byId.type] : undefined
    return type ?? targetFromText(fragment)
  }
  if (value.startsWith("/") && !value.startsWith("//")) return targetFromText(value)
  return null
}

const DEFAULT_NAV_LABELS: Record<Exclude<SectionType, "hero">, string> = {
  about: "About",
  services: "Menu",
  gallery: "Gallery",
  contact: "Contact",
}
const DEFAULT_NAV_ORDER = ["about", "services", "gallery", "contact"] as const

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

type Content = Record<string, unknown>

/** The first section of each type. A design has room for one of each. */
function firstOfEachType(sections: unknown): Map<BlueprintSectionType, BlueprintSection> {
  const byType = new Map<BlueprintSectionType, BlueprintSection>()
  if (!Array.isArray(sections)) return byType
  for (const section of sections) {
    if (!isRecord(section) || !isRecord(section.content)) continue
    const type = section.type as BlueprintSectionType
    if (BLUEPRINT_SECTION_TYPES.has(type) && !byType.has(type)) {
      byType.set(type, section as unknown as BlueprintSection)
    }
  }
  return byType
}

function contentOf(section: BlueprintSection | undefined): Content {
  return section && isRecord(section.content) ? section.content : {}
}

function buildAbout(content: Content): AboutContent {
  return {
    heading: clean(content.heading, 120) || "About us",
    body: paragraphs(content.body),
    highlights: [],
  }
}

const MAX_SERVICE_ITEMS = 24

function buildServices(content: Content): ServicesContent {
  const items: ServiceItem[] = []
  const rawItems: unknown[] = Array.isArray(content.items) ? content.items : []

  for (const [index, entry] of rawItems.slice(0, MAX_SERVICE_ITEMS).entries()) {
    let name: string
    let description = ""
    let price = ""
    let image: ImageAsset | undefined

    if (isRecord(entry)) {
      name = firstText(entry, ["name", "title", "item", "label"], 120)
      description = firstText(entry, ["description", "details", "text"], 400)
      price = firstText(entry, ["price", "cost"], 40)
      const src = firstImageUrl(entry, ["imageUrl", "image", "src"])
      if (src) image = { src, alt: name }
    } else {
      name = clean(entry, 120)
    }
    if (!name) continue

    items.push({
      id: `item-${index + 1}`,
      name,
      description,
      ...(price ? { price } : {}),
      ...(image ? { image } : {}),
    })
  }

  const intro = clean(content.intro, 300)
  return {
    heading: clean(content.heading, 120) || "Menu",
    ...(intro ? { intro } : {}),
    items,
  }
}

const EMPTY_ADDRESS: PostalAddress = {
  street: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
}

/**
 * The backend writes the address as one string. A single string cannot be split
 * into street, city and so on without guessing, so it is kept whole in
 * `street`. An object with separate parts (a model may return one) is mapped.
 */
function buildAddress(value: unknown): PostalAddress {
  if (typeof value === "string") return { ...EMPTY_ADDRESS, street: clean(value, 200) }
  if (!isRecord(value)) return { ...EMPTY_ADDRESS }
  return {
    street: firstText(value, ["street", "line1", "address"], 200),
    city: clean(value.city, 80),
    region: firstText(value, ["region", "state"], 80),
    postalCode: firstText(value, ["postalCode", "zip", "postcode"], 20),
    country: clean(value.country, 80),
  }
}

/** "Mon-Fri: 7 AM - 5 PM" becomes days and hours. Without ": " the line is kept as days. */
function splitHoursLine(line: string): OpeningHours {
  const separator = line.indexOf(": ")
  return separator > 0
    ? { days: line.slice(0, separator).trim(), hours: line.slice(separator + 2).trim() }
    : { days: line, hours: "" }
}

function buildOpeningHours(value: unknown): OpeningHours[] {
  const entries: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|;/)
      : []

  const hours: OpeningHours[] = []
  const usedDays = new Set<string>()
  for (const entry of entries.slice(0, 14)) {
    let row: OpeningHours
    if (isRecord(entry)) {
      const days = firstText(entry, ["days", "day", "label"], 60)
      const open = clean(entry.open, 30)
      const close = clean(entry.close, 30)
      const range = open && close ? `${open} - ${close}` : ""
      row = { days, hours: firstText(entry, ["hours", "time"], 60) || range }
    } else {
      const line = clean(entry, 120)
      row = line ? splitHoursLine(line) : { days: "", hours: "" }
    }
    if (!row.days && row.hours) row = { days: row.hours, hours: "" }
    if (!row.days) continue

    // The renderer uses `days` as the list key, so it has to be unique.
    let days = row.days
    for (let n = 2; usedDays.has(days); n += 1) days = `${row.days} (${n})`
    usedDays.add(days)
    hours.push({ days, hours: row.hours })
  }
  return hours
}

function buildContact(content: Content): ContactContent {
  return {
    heading: clean(content.heading, 120) || "Contact",
    address: buildAddress(content.address),
    phone: clean(content.phone, 40),
    email: clean(content.email, 120),
    openingHours: buildOpeningHours(content.hours ?? content.openingHours),
  }
}

function hasAddress(address: PostalAddress): boolean {
  return Object.values(address).some(Boolean)
}

const MIN_GALLERY_IMAGES = 3
const MAX_GALLERY_IMAGES = 6

function buildGallery(
  images: readonly CaptureImage[],
  businessName: string
): GalleryContent {
  const gallery: GalleryImage[] = images
    .slice(0, MAX_GALLERY_IMAGES)
    .map((image, index) => ({
      id: `gallery-${index + 1}`,
      src: image.src,
      alt: image.alt || `${businessName} photo ${index + 1}`,
    }))
  return { heading: "Gallery", images: gallery }
}

/**
 * The backend's footer holds one line, `copyright`, which models usually write
 * as "© 2025 Business Name. All rights reserved." The renderer already prints
 * "© {businessName}." in front of the legal text, so the symbol, year and
 * business name are removed here to avoid saying them twice. If nothing is
 * left the legal text is empty. No wording is invented.
 */
function legalTextFrom(copyright: unknown, businessName: string): string {
  let text = typeof copyright === "string" ? clean(copyright, 200) : ""
  const name = businessName.toLowerCase()

  for (let pass = 0; pass < 5; pass += 1) {
    const before = text
    text = text
      .replace(/^(?:©|\(c\)|copyright(?![a-z]))\s*/i, "")
      .replace(/^(?:19|20)\d{2}(?:\s*[-–—]\s*(?:19|20)?\d{2})?\b\s*/, "")
    if (name && text.toLowerCase().startsWith(name)) {
      text = text.slice(businessName.length)
    }
    text = text.replace(/^[\s.,:;\-–—]+/, "")
    if (text === before) break
  }
  return text
}

const MAX_TAGLINE_LENGTH = 160

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/**
 * Builds the design for a blueprint. Pass the capture the blueprint was made
 * from to fill things the blueprint has no field for: a hero image when the
 * model left it empty, a photo gallery, and social links.
 *
 * Mapping summary (blueprint -> design):
 * - theme: two colours and a font become the full theme (lib/blueprint-theme.ts).
 * - header.navigation labels become in-page links to sections that exist.
 * - hero: headline, subheadline, button text; the button's "#section" href
 *   becomes a section target.
 * - about: `body` text is split into paragraphs.
 * - menu is drawn as the "services" section.
 * - contact: the address string is kept whole, hours lines are split.
 * - footer: `copyright` becomes the legal line.
 * - gallery has no blueprint section. It is built from the capture's images and
 *   shown only when there are enough of them.
 * - Section ids are fixed ("hero", "about", "services", "gallery", "contact")
 *   so they are always unique and safe to use as anchors.
 * - A section is hidden when the blueprint hides it or when it has no content.
 *
 * Known limits: only the first section of each type is used; the footer cannot
 * be hidden (the renderer always draws it).
 */
export function blueprintToDesign(
  blueprint: WebsiteBlueprint,
  capture?: WebsiteCapture | null
): WebsiteDesign {
  const businessName = clean(blueprint.businessName, 120) || "Your business"
  const description = clean(blueprint.description, 300)
  const byType = firstOfEachType(blueprint.sections)

  const about = buildAbout(contentOf(byType.get("about")))
  const services = buildServices(contentOf(byType.get("menu")))
  const contact = buildContact(contentOf(byType.get("contact")))

  // Images: the hero takes the model's image, else the first photo from the
  // original site. The gallery gets the remaining photos.
  const heroContent = contentOf(byType.get("hero"))
  const photos = usableImages(capture)
  const modelHeroSrc = firstImageUrl(heroContent, ["imageUrl", "image"])
  const capturedHero = modelHeroSrc ? undefined : photos[0]
  const heroImage: ImageAsset = modelHeroSrc
    ? { src: modelHeroSrc, alt: businessName }
    : capturedHero
      ? { src: capturedHero.src, alt: capturedHero.alt || businessName }
      : { src: "", alt: businessName }
  const galleryPhotos = photos.filter(
    (photo) => photo.src !== heroImage.src && photo !== capturedHero
  )
  const gallery = buildGallery(galleryPhotos, businessName)

  // Which sections are drawn. A section the blueprint lacks is not drawn.
  const shownBy: Record<SectionType, boolean> = {
    hero: byType.get("hero")?.visible !== false && byType.has("hero"),
    about:
      byType.has("about") &&
      byType.get("about")?.visible !== false &&
      about.body.length > 0,
    services:
      byType.has("menu") &&
      byType.get("menu")?.visible !== false &&
      services.items.length > 0,
    gallery: gallery.images.length >= MIN_GALLERY_IMAGES,
    contact:
      byType.has("contact") &&
      byType.get("contact")?.visible !== false &&
      (hasAddress(contact.address) ||
        Boolean(contact.phone) ||
        Boolean(contact.email) ||
        contact.openingHours.length > 0),
  }

  // Section list in blueprint order, with the gallery placed before contact.
  const sections: SectionConfig[] = []
  const placed = new Set<SectionType>()
  const blueprintSections: unknown[] = Array.isArray(blueprint.sections)
    ? blueprint.sections
    : []
  for (const section of blueprintSections) {
    const type = isRecord(section)
      ? DESIGN_TYPE[section.type as BlueprintSectionType]
      : undefined
    if (!type || placed.has(type)) continue
    placed.add(type)
    sections.push({ id: type, type, visible: shownBy[type] })
  }
  if (gallery.images.length >= MIN_GALLERY_IMAGES) {
    const contactAt = sections.findIndex((section) => section.type === "contact")
    const entry: SectionConfig = { id: "gallery", type: "gallery", visible: true }
    if (contactAt === -1) sections.push(entry)
    else sections.splice(contactAt, 0, entry)
  }
  const isShown = (type: SectionType) =>
    sections.some((section) => section.type === type && section.visible)

  // Navigation: the header's labels, kept only when they point at a drawn section.
  const header = byType.get("header")
  const navItems: SectionLink[] = []
  if (header?.visible !== false) {
    const labels: unknown[] = Array.isArray(contentOf(header).navigation)
      ? (contentOf(header).navigation as unknown[])
      : []
    for (const entry of labels.slice(0, 12)) {
      const label = clean(isRecord(entry) ? firstText(entry, ["label", "text", "name"], 30) : entry, 30)
      const target = label ? targetFromText(label) : null
      if (target && isShown(target) && !navItems.some((item) => item.sectionId === target)) {
        navItems.push({ label, sectionId: target })
      }
    }
    if (navItems.length === 0) {
      for (const type of DEFAULT_NAV_ORDER) {
        if (isShown(type)) navItems.push({ label: DEFAULT_NAV_LABELS[type], sectionId: type })
      }
    }
  }
  const navigation: NavigationContent = { items: navItems }

  // Hero button. It has to scroll to a drawn section other than the hero. An
  // empty sectionId makes the renderer skip the button.
  const buttonLabel = clean(heroContent.primaryButtonText, 40)
  const buttonTarget =
    [
      typeof heroContent.primaryButtonHref === "string"
        ? targetFromHref(heroContent.primaryButtonHref, blueprint)
        : null,
      buttonLabel ? targetFromText(buttonLabel) : null,
      "contact" as const,
      "services" as const,
      "about" as const,
      "gallery" as const,
    ].find((type): type is SectionType => type !== null && type !== "hero" && isShown(type)) ?? null
  const primaryCta: SectionLink = buttonTarget
    ? {
        label: buttonLabel || (buttonTarget === "contact" ? "Contact us" : "Learn more"),
        sectionId: buttonTarget,
      }
    : { label: "", sectionId: "" }

  const hero: HeroContent = {
    headline: clean(heroContent.headline, 160) || businessName,
    subheadline: clean(heroContent.subheadline, 300) || description,
    primaryCta,
    image: heroImage,
  }

  const footerContent = contentOf(byType.get("footer"))
  const tagline = clean(footerContent.tagline, MAX_TAGLINE_LENGTH) ||
    clean(blueprint.description, MAX_TAGLINE_LENGTH)
  const footer: FooterContent = {
    ...(tagline ? { tagline } : {}),
    links: navItems.filter((item) => item.sectionId !== "hero").slice(0, 6),
    socialLinks: socialLinksFrom(capture),
    legalText: legalTextFrom(footerContent.copyright, businessName),
  }

  const siteTagline = clean(blueprint.description, MAX_TAGLINE_LENGTH)
  return {
    schemaVersion: 1,
    businessName,
    ...(siteTagline ? { tagline: siteTagline } : {}),
    theme: deriveTheme(isRecord(blueprint.theme) ? blueprint.theme : {}),
    navigation,
    hero,
    about,
    services,
    gallery,
    contact,
    footer,
    sections,
  }
}

/**
 * Parses a raw backend blueprint (and optionally a raw capture) and converts
 * them. A bad blueprint is an error. A bad capture is ignored, because it only
 * adds extras. `blueprint` in the result is the cleaned copy to store for edits.
 */
export function adaptBlueprint(
  rawBlueprint: unknown,
  rawCapture?: unknown
): ParseResult<{ blueprint: WebsiteBlueprint; design: WebsiteDesign }> {
  const blueprint = parseBlueprint(rawBlueprint)
  if (!blueprint.ok) return blueprint

  const capture = rawCapture === undefined ? null : parseCapture(rawCapture)
  return ok({
    blueprint: blueprint.value,
    design: blueprintToDesign(blueprint.value, capture?.ok ? capture.value : null),
  })
}
