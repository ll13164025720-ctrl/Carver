import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  adaptBlueprint,
  blueprintToDesign,
  parseBlueprint,
  parseCapture,
} from "@/lib/blueprint-adapter"
import {
  SUPPORTED_FONTS,
  contrastRatio,
  deriveFonts,
  deriveTheme,
} from "@/lib/blueprint-theme"
import { isWebsiteDesign } from "@/lib/site-revive-api"
import { fontStack, isHexColor } from "@/lib/website-render"
import type {
  BlueprintSection,
  BlueprintSectionType,
  WebsiteBlueprint,
  WebsiteCapture,
} from "@/types/backend"

/**
 * Run with `npm test` (Node's built-in test runner, TypeScript through tsx).
 * Fixtures follow the shape that apps/backend/src/handler.ts asks the model for.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function section(
  type: BlueprintSectionType,
  content: Record<string, unknown>,
  overrides: Partial<BlueprintSection> = {}
): BlueprintSection {
  return { id: `${type}-main`, type, visible: true, content, ...overrides }
}

/** A complete, well-formed blueprint like the backend produces. */
function makeBlueprint(overrides: Partial<WebsiteBlueprint> = {}): WebsiteBlueprint {
  return {
    schemaVersion: "1.0",
    siteId: "demo-site",
    slug: "sunrise-corner-cafe",
    businessName: "Sunrise Corner Café",
    description: "Small-batch coffee and fresh pastries.",
    theme: { primaryColor: "#7A3E1D", secondaryColor: "#2F4A3A", fontFamily: "Lora" },
    sections: [
      section("header", {
        logoText: "Sunrise Corner Café",
        navigation: ["Home", "About", "Menu", "Contact"],
      }),
      section("hero", {
        eyebrow: "Welcome",
        headline: "Coffee, made slow",
        subheadline: "Roasted nearby, baked every morning.",
        primaryButtonText: "Find us",
        primaryButtonHref: "#contact",
        imageUrl: "",
      }),
      section("about", {
        heading: "Our story",
        body: "We opened in 2014.\n\nWe still know our regulars by name.",
      }),
      section("menu", {
        heading: "What we serve",
        items: [
          { name: "Espresso", description: "Double shot", price: "$3.50" },
          { name: "Croissant", description: "Butter, baked daily" },
        ],
      }),
      section("contact", {
        heading: "Come say hello",
        address: "214 Alder Street, Portland, OR 97205",
        phone: "(503) 555-0142",
        email: "hello@example.com",
        hours: ["Mon-Fri: 7:00 AM - 5:00 PM", "Sat-Sun: 8:00 AM - 4:00 PM"],
      }),
      section("footer", { copyright: "© 2025 Sunrise Corner Café. All rights reserved." }),
    ],
    ...overrides,
  }
}

/** Same blueprint with every content object emptied, as when the model had nothing to say. */
function makeEmptyBlueprint(): WebsiteBlueprint {
  const blueprint = makeBlueprint()
  return {
    ...blueprint,
    sections: blueprint.sections.map((s) => ({ ...s, content: {} })),
  }
}

function makeCapture(overrides: Partial<WebsiteCapture> = {}): WebsiteCapture {
  return {
    captureId: "1bd89974-ee3d-4b89-b0f2-2138fad9724b",
    sourceUrl: "https://old-cafe.example/",
    finalUrl: "https://old-cafe.example/",
    capturedAt: "2026-11-07T10:00:00.000Z",
    title: "Old Cafe",
    description: "",
    headings: [],
    text: "",
    links: [],
    images: [],
    screenshots: {
      desktop: "http://localhost:3002/artifacts/1bd89974-ee3d-4b89-b0f2-2138fad9724b-desktop.png",
      mobile: "http://localhost:3002/artifacts/1bd89974-ee3d-4b89-b0f2-2138fad9724b-mobile.png",
    },
    ...overrides,
  }
}

const photo = (n: number, alt = "") => ({
  src: `https://old-cafe.example/photos/shop-${n}.jpg`,
  alt,
})

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function setContent(
  blueprint: WebsiteBlueprint,
  type: BlueprintSectionType,
  content: Record<string, unknown>
): WebsiteBlueprint {
  return {
    ...blueprint,
    sections: blueprint.sections.map((s) => (s.type === type ? { ...s, content } : s)),
  }
}

function assertRenderable(design: unknown): void {
  assert.ok(isWebsiteDesign(design), "design must pass the renderer's structural check")
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

describe("deriveTheme", () => {
  it("keeps the brand colours and normalises their case", () => {
    const { colors } = deriveTheme({ primaryColor: "#7a3e1d", secondaryColor: "#2f4a3a" })
    assert.equal(colors.primary, "#7A3E1D")
    assert.equal(colors.secondary, "#2F4A3A")
  })

  it("falls back to neutral colours for missing or invalid input", () => {
    for (const input of [
      {},
      { primaryColor: "red", secondaryColor: 5 },
      { primaryColor: "#12345", secondaryColor: null },
      { primaryColor: "url(javascript:alert(1))" },
    ]) {
      const { colors } = deriveTheme(input)
      for (const value of Object.values(colors)) assert.ok(isHexColor(value), value)
    }
  })

  it("produces readable text on the page background for any palette", () => {
    const palettes = ["#112233", "#FFFFFF", "#000000", "#FFEE00", "#7A3E1D", "#808080", "#00FFFF"]
    for (const primary of palettes) {
      const { colors } = deriveTheme({ primaryColor: primary, secondaryColor: "#F4F1EA" })
      assert.ok(contrastRatio(colors.text, colors.background) >= 7, `text on ${primary}`)
      assert.ok(contrastRatio(colors.mutedText, colors.background) >= 4.5, `muted on ${primary}`)
      assert.ok(contrastRatio(colors.mutedText, colors.surface) >= 4.5, `muted on white (${primary})`)
      for (const value of Object.values(colors)) assert.ok(isHexColor(value), value)
    }
  })

  it("uses the secondary colour as accent only when it stands out from the page", () => {
    const cream = deriveTheme({ primaryColor: "#112233", secondaryColor: "#F4F1EA" })
    assert.equal(cream.colors.accent, "#112233")
    const green = deriveTheme({ primaryColor: "#112233", secondaryColor: "#2F4A3A" })
    assert.equal(green.colors.accent, "#2F4A3A")
  })
})

describe("deriveFonts", () => {
  it("pairs a serif heading font with a sans-serif body", () => {
    assert.deepEqual(deriveFonts("Playfair Display"), {
      headingFont: "Playfair Display",
      bodyFont: "Inter",
    })
  })

  it("uses a sans-serif font for both", () => {
    assert.deepEqual(deriveFonts("Poppins"), { headingFont: "Poppins", bodyFont: "Poppins" })
  })

  it("accepts CSS-style lists, quotes and any case", () => {
    assert.equal(deriveFonts("'Lora', Georgia, serif").headingFont, "Lora")
    assert.equal(deriveFonts('"open sans", sans-serif').headingFont, "Open Sans")
  })

  it("falls back to Inter for unknown or non-string fonts", () => {
    for (const input of ["Comic Sans MS", "", undefined, null, 12, {}]) {
      assert.deepEqual(deriveFonts(input), { headingFont: "Inter", bodyFont: "Inter" })
    }
  })

  it("only lists fonts the renderer really has a stack for", () => {
    const unknown = fontStack("definitely not a font")
    for (const name of SUPPORTED_FONTS) {
      assert.notEqual(fontStack(name), unknown, `${name} is missing from the renderer's font list`)
    }
  })
})

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe("parseBlueprint", () => {
  it("accepts a valid blueprint and returns an independent copy", () => {
    const original = makeBlueprint()
    const result = parseBlueprint(original)
    assert.ok(result.ok)
    assert.deepEqual(result.value, original)
    assert.notEqual(result.value, original)
    result.value.sections[1].content.headline = "changed"
    assert.equal(original.sections[1].content.headline, "Coffee, made slow")
  })

  it("fills the backend defaults for a missing description and visible flag", () => {
    const raw = JSON.parse(JSON.stringify(makeBlueprint())) as Record<string, unknown>
    delete raw.description
    for (const s of raw.sections as Array<Record<string, unknown>>) delete s.visible
    const result = parseBlueprint(raw)
    assert.ok(result.ok)
    assert.equal(result.value.description, "")
    assert.ok(result.value.sections.every((s) => s.visible === true))
  })

  it("rejects values the backend would reject", () => {
    const base = makeBlueprint()
    const cases: Array<[string, unknown]> = [
      ["null", null],
      ["array", []],
      ["wrong version", { ...base, schemaVersion: "2.0" }],
      ["numeric version", { ...base, schemaVersion: 1 }],
      ["empty siteId", { ...base, siteId: "" }],
      ["bad slug", { ...base, slug: "Has Spaces" }],
      ["empty name", { ...base, businessName: "" }],
      ["long name", { ...base, businessName: "x".repeat(121) }],
      ["long description", { ...base, description: "x".repeat(501) }],
      ["bad colour", { ...base, theme: { ...base.theme, primaryColor: "blue" } }],
      ["no font", { ...base, theme: { ...base.theme, fontFamily: "" } }],
      ["too few sections", { ...base, sections: base.sections.slice(0, 2) }],
      ["too many sections", { ...base, sections: Array(13).fill(base.sections[0]) }],
      ["unknown type", { ...base, sections: [...base.sections.slice(1), { ...base.sections[0], type: "gallery" }] }],
      ["array content", { ...base, sections: [...base.sections.slice(1), { ...base.sections[0], content: [] }] }],
      ["string visible", { ...base, sections: [...base.sections.slice(1), { ...base.sections[0], visible: "yes" }] }],
    ]
    for (const [name, value] of cases) {
      const result = parseBlueprint(value)
      assert.equal(result.ok, false, name)
      if (!result.ok) assert.ok(result.error.length > 0, name)
    }
  })
})

describe("parseCapture", () => {
  it("accepts a valid capture", () => {
    const result = parseCapture(makeCapture({ images: [photo(1, "Counter")] }))
    assert.ok(result.ok)
    assert.equal(result.value.images[0].alt, "Counter")
  })

  it("requires the capture id and desktop screenshot only", () => {
    assert.equal(parseCapture(null).ok, false)
    assert.equal(parseCapture({}).ok, false)
    assert.equal(parseCapture({ captureId: "x", screenshots: {} }).ok, false)
    const result = parseCapture({ captureId: "x", screenshots: { desktop: "/a.png" } })
    assert.ok(result.ok)
    assert.deepEqual(result.value.images, [])
    assert.equal(result.value.screenshots.mobile, "")
  })

  it("drops malformed list entries instead of failing", () => {
    const result = parseCapture({
      captureId: "x",
      screenshots: { desktop: "/a.png" },
      images: [null, 5, { src: 3 }, { src: "https://a.example/1.jpg" }],
      links: ["x", { url: null }, { url: "https://a.example", text: 4 }],
      headings: [{ text: "Hi" }, { level: 2 }],
    })
    assert.ok(result.ok)
    assert.equal(result.value.images.length, 1)
    assert.deepEqual(result.value.links, [{ text: "", url: "https://a.example" }])
    assert.deepEqual(result.value.headings, [{ level: 2, text: "Hi" }])
  })
})

// ---------------------------------------------------------------------------
// Conversion: a normal blueprint
// ---------------------------------------------------------------------------

describe("blueprintToDesign: a complete blueprint", () => {
  const design = blueprintToDesign(makeBlueprint())

  it("produces a design the renderer accepts", () => {
    assertRenderable(design)
    assert.equal(design.schemaVersion, 1)
  })

  it("maps identity and theme", () => {
    assert.equal(design.businessName, "Sunrise Corner Café")
    assert.equal(design.tagline, "Small-batch coffee and fresh pastries.")
    assert.equal(design.theme.colors.primary, "#7A3E1D")
    assert.equal(design.theme.typography.headingFont, "Lora")
    assert.equal(design.theme.typography.bodyFont, "Inter")
  })

  it("maps the hero and turns the button href into a section target", () => {
    assert.equal(design.hero.headline, "Coffee, made slow")
    assert.equal(design.hero.subheadline, "Roasted nearby, baked every morning.")
    assert.deepEqual(design.hero.primaryCta, { label: "Find us", sectionId: "contact" })
    assert.equal(design.hero.secondaryCta, undefined)
  })

  it("splits the about text into paragraphs", () => {
    assert.equal(design.about.heading, "Our story")
    assert.deepEqual(design.about.body, ["We opened in 2014.", "We still know our regulars by name."])
    assert.deepEqual(design.about.highlights, [])
  })

  it("draws the menu as services", () => {
    assert.equal(design.services.heading, "What we serve")
    assert.deepEqual(design.services.items, [
      { id: "item-1", name: "Espresso", description: "Double shot", price: "$3.50" },
      { id: "item-2", name: "Croissant", description: "Butter, baked daily" },
    ])
  })

  it("maps contact details and splits hours lines", () => {
    assert.equal(design.contact.address.street, "214 Alder Street, Portland, OR 97205")
    assert.equal(design.contact.phone, "(503) 555-0142")
    assert.equal(design.contact.email, "hello@example.com")
    assert.deepEqual(design.contact.openingHours, [
      { days: "Mon-Fri", hours: "7:00 AM - 5:00 PM" },
      { days: "Sat-Sun", hours: "8:00 AM - 4:00 PM" },
    ])
  })

  it("lists sections in blueprint order with fixed ids", () => {
    assert.deepEqual(design.sections, [
      { id: "hero", type: "hero", visible: true },
      { id: "about", type: "about", visible: true },
      { id: "services", type: "services", visible: true },
      { id: "contact", type: "contact", visible: true },
    ])
  })

  it("links the navigation to drawn sections", () => {
    assert.deepEqual(design.navigation.items, [
      { label: "Home", sectionId: "hero" },
      { label: "About", sectionId: "about" },
      { label: "Menu", sectionId: "services" },
      { label: "Contact", sectionId: "contact" },
    ])
    for (const item of [...design.navigation.items, ...design.footer.links]) {
      assert.ok(design.sections.some((s) => s.id === item.sectionId && s.visible), item.label)
    }
  })

  it("does not repeat the copyright symbol, year or name in the legal text", () => {
    assert.equal(design.footer.legalText, "All rights reserved.")
  })

  it("has no gallery or social links without a capture", () => {
    assert.deepEqual(design.gallery.images, [])
    assert.deepEqual(design.footer.socialLinks, [])
  })

  it("does not mutate its input", () => {
    assert.doesNotThrow(() => blueprintToDesign(deepFreeze(makeBlueprint()), deepFreeze(makeCapture())))
  })
})

// ---------------------------------------------------------------------------
// Conversion: missing and odd data
// ---------------------------------------------------------------------------

describe("blueprintToDesign: missing data", () => {
  const design = blueprintToDesign(makeEmptyBlueprint())

  it("still produces a renderable design", () => {
    assertRenderable(design)
  })

  it("falls back to the business name and description for the hero", () => {
    assert.equal(design.hero.headline, "Sunrise Corner Café")
    assert.equal(design.hero.subheadline, "Small-batch coffee and fresh pastries.")
  })

  it("hides sections that would be empty shells", () => {
    const visible = Object.fromEntries(design.sections.map((s) => [s.type, s.visible]))
    assert.deepEqual(visible, { hero: true, about: false, services: false, contact: false })
  })

  it("has no navigation, and no hero button, when nothing can be linked to", () => {
    assert.deepEqual(design.navigation.items, [])
    assert.deepEqual(design.hero.primaryCta, { label: "", sectionId: "" })
    assert.deepEqual(design.footer.links, [])
  })

  it("gives the hero image alt text and an empty source when there is no image", () => {
    assert.deepEqual(design.hero.image, { src: "", alt: "Sunrise Corner Café" })
  })

  it("invents no legal text or contact details", () => {
    assert.equal(design.footer.legalText, "")
    assert.equal(design.contact.phone, "")
    assert.equal(design.contact.email, "")
    assert.deepEqual(design.contact.openingHours, [])
  })

  it("handles a blueprint with required section types missing", () => {
    const blueprint = makeBlueprint({
      sections: [section("hero", { headline: "Hi" }), section("footer", {}), section("header", {})],
    })
    const result = blueprintToDesign(blueprint)
    assertRenderable(result)
    assert.deepEqual(result.sections, [{ id: "hero", type: "hero", visible: true }])
    assert.equal(result.about.body.length, 0)
  })

  it("shows contact when only one detail is known", () => {
    const result = blueprintToDesign(setContent(makeBlueprint(), "contact", { phone: "555-0100" }))
    assert.equal(result.sections.find((s) => s.type === "contact")?.visible, true)
    assert.equal(result.contact.heading, "Contact")
  })

  it("uses only the first section of each type", () => {
    const blueprint = makeBlueprint()
    blueprint.sections.push(section("about", { body: "Second" }, { id: "about-2" }))
    const result = blueprintToDesign(blueprint)
    assert.equal(result.sections.filter((s) => s.type === "about").length, 1)
    assert.equal(result.about.body[0], "We opened in 2014.")
  })

  it("respects sections the blueprint hides", () => {
    const blueprint = makeBlueprint()
    blueprint.sections = blueprint.sections.map((s) =>
      s.type === "menu" || s.type === "header" ? { ...s, visible: false } : s
    )
    const result = blueprintToDesign(blueprint)
    assert.equal(result.sections.find((s) => s.type === "services")?.visible, false)
    assert.deepEqual(result.navigation.items, [])
    assert.ok(!result.footer.links.some((link) => link.sectionId === "services"))
  })
})

describe("blueprintToDesign: unexpected content types", () => {
  it("never throws and always yields a renderable design for hostile content", () => {
    const junk: unknown[] = [
      null,
      undefined,
      true,
      0,
      -1,
      NaN,
      Infinity,
      "",
      "   ",
      "x".repeat(50_000),
      [],
      [null, 1, {}, [], "text"],
      {},
      { nested: { deeper: [1, 2, { x: null }] } },
      "<script>alert(1)</script>",
      "javascript:alert(1)",
      "\u0000\u202E\u200Bevil",
    ]
    const keys = [
      "heading", "body", "headline", "subheadline", "primaryButtonText", "primaryButtonHref",
      "imageUrl", "items", "address", "phone", "email", "hours", "copyright", "navigation",
      "logoText", "intro", "image",
    ]
    const types: BlueprintSectionType[] = ["header", "hero", "about", "menu", "contact", "footer"]

    for (const value of junk) {
      const content = Object.fromEntries(keys.map((key) => [key, value]))
      const blueprint = makeBlueprint({
        sections: types.map((type) => section(type, content)),
      })
      let design: ReturnType<typeof blueprintToDesign> | undefined
      assert.doesNotThrow(() => {
        design = blueprintToDesign(blueprint, makeCapture())
      }, `content value: ${String(value).slice(0, 30)}`)
      assertRenderable(design)
    }
  })

  it("never throws when list entries are the wrong type", () => {
    const blueprint = setContent(
      setContent(makeBlueprint(), "menu", { items: [null, 5, "Soup", [], { name: 7 }, { name: "" }, { title: "Tea", price: 2.5 }] }),
      "contact",
      { hours: [null, 5, {}, { day: "Mon", open: "9", close: "5" }, { days: "Tue", hours: ["x"] }] }
    )
    const design = blueprintToDesign(blueprint)
    assertRenderable(design)
    assert.deepEqual(
      design.services.items.map((item) => [item.name, item.price]),
      [["5", undefined], ["Soup", undefined], ["7", undefined], ["Tea", "2.5"]]
    )
    assert.deepEqual(design.contact.openingHours, [
      { days: "5", hours: "" },
      { days: "Mon", hours: "9 - 5" },
      { days: "Tue", hours: "" },
    ])
  })

  it("cleans text: invisible characters, whitespace and length", () => {
    const blueprint = setContent(makeBlueprint(), "hero", {
      headline: "  Hello\u202E \u200Bworld \n\t again  ",
      subheadline: "y".repeat(1000),
    })
    const { hero } = blueprintToDesign(blueprint)
    assert.equal(hero.headline, "Hello world again")
    assert.ok(hero.subheadline.length <= 300)
    assert.ok(hero.subheadline.endsWith("…"))
  })

  it("keeps markup as plain text rather than interpreting it", () => {
    const blueprint = setContent(makeBlueprint(), "about", {
      heading: "<img src=x onerror=alert(1)>",
      body: "<b>bold</b>",
    })
    const { about } = blueprintToDesign(blueprint)
    assert.equal(about.heading, "<img src=x onerror=alert(1)>")
    assert.deepEqual(about.body, ["<b>bold</b>"])
  })

  it("only accepts http(s) image URLs", () => {
    for (const imageUrl of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//evil.example/x.png",
      "/relative/x.png",
      "file:///etc/passwd",
      "not a url",
    ]) {
      const blueprint = setContent(makeBlueprint(), "hero", { imageUrl })
      assert.equal(blueprintToDesign(blueprint).hero.image.src, "", imageUrl)
    }
    const good = setContent(makeBlueprint(), "hero", { imageUrl: "https://cdn.example/a.jpg" })
    assert.equal(blueprintToDesign(good).hero.image.src, "https://cdn.example/a.jpg")
  })

  it("drops menu item images that are not http(s)", () => {
    const blueprint = setContent(makeBlueprint(), "menu", {
      items: [
        { name: "A", imageUrl: "javascript:alert(1)" },
        { name: "B", image: { src: "https://cdn.example/b.jpg" } },
      ],
    })
    const { items } = blueprintToDesign(blueprint).services
    assert.equal(items[0].image, undefined)
    assert.deepEqual(items[1].image, { src: "https://cdn.example/b.jpg", alt: "B" })
  })

  it("caps the number of menu items and paragraphs", () => {
    const blueprint = setContent(
      setContent(makeBlueprint(), "menu", {
        items: Array.from({ length: 100 }, (_, i) => ({ name: `Item ${i}` })),
      }),
      "about",
      { body: Array.from({ length: 30 }, (_, i) => `Paragraph ${i}`) }
    )
    const design = blueprintToDesign(blueprint)
    assert.equal(design.services.items.length, 24)
    assert.equal(design.about.body.length, 8)
  })
})

describe("blueprintToDesign: contact details", () => {
  it("maps an address given as separate parts", () => {
    const blueprint = setContent(makeBlueprint(), "contact", {
      address: { street: "1 Main St", city: "Portland", state: "OR", zip: "97205", country: "USA" },
    })
    assert.deepEqual(blueprintToDesign(blueprint).contact.address, {
      street: "1 Main St",
      city: "Portland",
      region: "OR",
      postalCode: "97205",
      country: "USA",
    })
  })

  it("keeps hours unique and accepts one multi-line string", () => {
    const blueprint = setContent(makeBlueprint(), "contact", {
      hours: "Mon: 9-5\nMon: 10-6\nClosed Sundays",
    })
    assert.deepEqual(blueprintToDesign(blueprint).contact.openingHours, [
      { days: "Mon", hours: "9-5" },
      { days: "Mon (2)", hours: "10-6" },
      { days: "Closed Sundays", hours: "" },
    ])
  })

  it("keeps times that contain colons together", () => {
    const blueprint = setContent(makeBlueprint(), "contact", {
      hours: ["Monday to Friday: 7:00 AM - 5:00 PM"],
    })
    assert.deepEqual(blueprintToDesign(blueprint).contact.openingHours, [
      { days: "Monday to Friday", hours: "7:00 AM - 5:00 PM" },
    ])
  })
})

// ---------------------------------------------------------------------------
// Conversion: navigation and hero button
// ---------------------------------------------------------------------------

describe("blueprintToDesign: navigation", () => {
  const withNav = (navigation: unknown) =>
    blueprintToDesign(setContent(makeBlueprint(), "header", { navigation }))

  it("drops labels that match no section and removes duplicates", () => {
    const { items } = withNav(["About", "Careers", "About us", "Contact", "Blog"]).navigation
    assert.deepEqual(items, [
      { label: "About", sectionId: "about" },
      { label: "Contact", sectionId: "contact" },
    ])
  })

  it("accepts label objects", () => {
    const { items } = withNav([{ label: "Menu" }, { text: "Visit us" }, { name: "About" }]).navigation
    assert.deepEqual(
      items.map((item) => item.sectionId),
      ["services", "contact", "about"]
    )
  })

  it("builds a default menu when the header has no usable labels", () => {
    for (const navigation of [undefined, [], "About", ["Careers"], [null, 5]]) {
      assert.deepEqual(
        withNav(navigation).navigation.items,
        [
          { label: "About", sectionId: "about" },
          { label: "Menu", sectionId: "services" },
          { label: "Contact", sectionId: "contact" },
        ],
        JSON.stringify(navigation)
      )
    }
  })

  it("leaves out links to hidden or empty sections", () => {
    const blueprint = setContent(makeBlueprint(), "menu", { items: [] })
    const { items } = blueprintToDesign(blueprint).navigation
    assert.ok(!items.some((item) => item.sectionId === "services"))
  })
})

describe("blueprintToDesign: hero button", () => {
  const withButton = (content: Record<string, unknown>, blueprint = makeBlueprint()) =>
    blueprintToDesign(setContent(blueprint, "hero", { headline: "H", ...content })).hero.primaryCta

  it("resolves a '#section-id' href through the blueprint's own section ids", () => {
    assert.deepEqual(withButton({ primaryButtonText: "Go", primaryButtonHref: "#menu-main" }), {
      label: "Go",
      sectionId: "services",
    })
  })

  it("resolves a '#keyword' href", () => {
    assert.equal(withButton({ primaryButtonText: "Go", primaryButtonHref: "#about" }).sectionId, "about")
  })

  it("uses the label when the href leads off the page", () => {
    const cta = withButton({ primaryButtonText: "Order online", primaryButtonHref: "https://shop.example/" })
    assert.deepEqual(cta, { label: "Order online", sectionId: "services" })
  })

  it("falls back to contact when nothing else matches", () => {
    assert.deepEqual(withButton({ primaryButtonText: "Click me!", primaryButtonHref: "https://x.example" }), {
      label: "Click me!",
      sectionId: "contact",
    })
  })

  it("adds a label when the button text is empty", () => {
    assert.deepEqual(withButton({ primaryButtonText: "", primaryButtonHref: "#contact" }), {
      label: "Contact us",
      sectionId: "contact",
    })
  })

  it("never points at a hidden or missing section", () => {
    const cta = withButton(
      { primaryButtonText: "Find us", primaryButtonHref: "#contact" },
      setContent(makeBlueprint(), "contact", {})
    )
    assert.notEqual(cta.sectionId, "contact")
    assert.ok(["services", "about", ""].includes(cta.sectionId))
  })
})

// ---------------------------------------------------------------------------
// Conversion: capture data
// ---------------------------------------------------------------------------

describe("blueprintToDesign: capture data", () => {
  it("uses the first original photo as the hero image when the model gave none", () => {
    const capture = makeCapture({ images: [photo(1, "The shop front"), photo(2), photo(3), photo(4)] })
    const { hero } = blueprintToDesign(makeBlueprint(), capture)
    assert.deepEqual(hero.image, { src: photo(1).src, alt: "The shop front" })
  })

  it("prefers an image the model chose", () => {
    const blueprint = setContent(makeBlueprint(), "hero", { imageUrl: "https://cdn.example/model.jpg" })
    const { hero } = blueprintToDesign(blueprint, makeCapture({ images: [photo(1)] }))
    assert.equal(hero.image.src, "https://cdn.example/model.jpg")
  })

  it("skips logos, icons, SVGs, tracking pixels, duplicates and non-http images", () => {
    const capture = makeCapture({
      images: [
        { src: "https://old-cafe.example/logo.png", alt: "" },
        { src: "https://old-cafe.example/img/favicon.ico", alt: "" },
        { src: "https://old-cafe.example/hero.svg", alt: "" },
        { src: "https://old-cafe.example/track/1x1.gif", alt: "" },
        { src: "data:image/png;base64,AAAA", alt: "" },
        { src: "javascript:alert(1)", alt: "" },
        photo(1),
        photo(1),
      ],
    })
    const design = blueprintToDesign(makeBlueprint(), capture)
    assert.equal(design.hero.image.src, photo(1).src)
    assert.deepEqual(design.gallery.images, [])
  })

  it("builds a gallery from the remaining photos and places it before contact", () => {
    const capture = makeCapture({ images: [1, 2, 3, 4, 5].map((n) => photo(n)) })
    const design = blueprintToDesign(makeBlueprint(), capture)
    assertRenderable(design)
    // Photo 1 is the hero image, so the gallery has photos 2 to 5.
    assert.deepEqual(
      design.gallery.images.map((image) => image.src),
      [2, 3, 4, 5].map((n) => photo(n).src)
    )
    assert.ok(design.gallery.images.every((image) => image.alt.length > 0))
    assert.deepEqual(
      design.sections.map((s) => s.id),
      ["hero", "about", "services", "gallery", "contact"]
    )
  })

  it("shows no gallery when fewer than three photos remain", () => {
    const capture = makeCapture({ images: [1, 2, 3].map((n) => photo(n)) })
    const design = blueprintToDesign(makeBlueprint(), capture)
    assert.ok(!design.sections.some((s) => s.type === "gallery"))
    assert.ok(!design.navigation.items.some((item) => item.sectionId === "gallery"))
  })

  it("limits the gallery to six photos with unique ids", () => {
    const capture = makeCapture({ images: Array.from({ length: 20 }, (_, i) => photo(i + 1)) })
    const { gallery } = blueprintToDesign(makeBlueprint(), capture)
    assert.equal(gallery.images.length, 6)
    assert.equal(new Set(gallery.images.map((image) => image.id)).size, 6)
  })

  it("adds the gallery to the menu only when the header asks for it", () => {
    const capture = makeCapture({ images: Array.from({ length: 6 }, (_, i) => photo(i + 1)) })
    const blueprint = setContent(makeBlueprint(), "header", { navigation: ["About", "Photos"] })
    const { items } = blueprintToDesign(blueprint, capture).navigation
    assert.deepEqual(items.map((item) => item.sectionId), ["about", "gallery"])
  })

  it("collects the original site's social profile links", () => {
    const capture = makeCapture({
      links: [
        { text: "", url: "https://www.instagram.com/oldcafe/" },
        { text: "", url: "https://www.instagram.com/other/" },
        { text: "", url: "https://facebook.com/oldcafe" },
        { text: "", url: "https://twitter.com/oldcafe" },
        { text: "", url: "https://www.youtube.com/@oldcafe" },
        { text: "", url: "https://www.facebook.com/sharer/sharer.php?u=x" },
        { text: "", url: "https://www.tiktok.com/" },
        { text: "", url: "javascript:alert(1)" },
        { text: "", url: "mailto:hi@old-cafe.example" },
        { text: "", url: "https://notinstagram.com/oldcafe" },
      ],
    })
    const { socialLinks } = blueprintToDesign(makeBlueprint(), capture).footer
    assert.deepEqual(socialLinks, [
      { platform: "instagram", url: "https://www.instagram.com/oldcafe/" },
      { platform: "facebook", url: "https://facebook.com/oldcafe" },
      { platform: "x", url: "https://twitter.com/oldcafe" },
      { platform: "youtube", url: "https://www.youtube.com/@oldcafe" },
    ])
  })

  it("ignores a capture with unexpected contents", () => {
    const broken = { images: "nope", links: 5 } as unknown as WebsiteCapture
    assertRenderable(blueprintToDesign(makeBlueprint(), broken))
    assertRenderable(blueprintToDesign(makeBlueprint(), null))
  })
})

// ---------------------------------------------------------------------------
// Footer legal text
// ---------------------------------------------------------------------------

describe("blueprintToDesign: footer legal text", () => {
  const legal = (copyright: unknown) =>
    blueprintToDesign(setContent(makeBlueprint(), "footer", { copyright })).footer.legalText

  it("removes the symbol, year and business name", () => {
    assert.equal(legal("© 2025 Sunrise Corner Café. All rights reserved."), "All rights reserved.")
    assert.equal(legal("Copyright © 2020-2025 Sunrise Corner Café - All rights reserved"), "All rights reserved")
    assert.equal(legal("(c) sunrise corner café"), "")
    assert.equal(legal("© 2025 Sunrise Corner Café"), "")
  })

  it("keeps other text as it is", () => {
    assert.equal(legal("Licensed and insured."), "Licensed and insured.")
    assert.equal(legal("Copyrighted material of others"), "Copyrighted material of others")
  })

  it("is empty for missing or wrong-typed values", () => {
    for (const value of [undefined, null, 5, [], {}, ""]) assert.equal(legal(value), "", String(value))
  })
})

// ---------------------------------------------------------------------------
// Whole flow
// ---------------------------------------------------------------------------

describe("adaptBlueprint", () => {
  it("parses and converts, returning the cleaned blueprint for editing", () => {
    const result = adaptBlueprint(makeBlueprint(), makeCapture({ images: [photo(1)] }))
    assert.ok(result.ok)
    assert.deepEqual(result.value.blueprint, makeBlueprint())
    assertRenderable(result.value.design)
    assert.equal(result.value.design.hero.image.src, photo(1).src)
  })

  it("reports an invalid blueprint", () => {
    const result = adaptBlueprint({ nope: true })
    assert.equal(result.ok, false)
  })

  it("ignores an invalid capture", () => {
    const result = adaptBlueprint(makeBlueprint(), { not: "a capture" })
    assert.ok(result.ok)
    assertRenderable(result.value.design)
  })

  it("works without a capture", () => {
    assert.ok(adaptBlueprint(makeBlueprint()).ok)
  })

  it("survives a JSON round trip, as stored in sessionStorage", () => {
    const first = adaptBlueprint(makeBlueprint(), makeCapture({ images: [1, 2, 3, 4, 5].map((n) => photo(n)) }))
    assert.ok(first.ok)
    const second = adaptBlueprint(JSON.parse(JSON.stringify(first.value.blueprint)))
    assert.ok(second.ok)
    assert.deepEqual(second.value.blueprint, first.value.blueprint)
  })

  it("reflects a backend edit when converted again", () => {
    // /api/blueprints/edit applies {type:"set", sectionId, field, value} operations.
    const parsed = parseBlueprint(makeBlueprint())
    assert.ok(parsed.ok)
    const edited = structuredClone(parsed.value)
    const hero = edited.sections.find((s) => s.id === "hero-main")
    assert.ok(hero)
    hero.content.headline = "Welcome to Our Cafe"
    hero.content.primaryButtonText = "Contact Us"

    const design = blueprintToDesign(edited)
    assert.equal(design.hero.headline, "Welcome to Our Cafe")
    assert.equal(design.hero.primaryCta.label, "Contact Us")
    assert.equal(blueprintToDesign(parsed.value).hero.headline, "Coffee, made slow")
  })
})
