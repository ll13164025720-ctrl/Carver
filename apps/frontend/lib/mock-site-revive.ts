import type { RedesignResult, WebsiteDesign } from "@/types/website"

/**
 * Mock data for the frontend while the backend does not exist yet.
 * Nothing here fetches, scrapes or calls any service. All images are
 * placeholder URLs, and all contact details are fictional.
 */

const placeholder = (width: number, height: number, label: string) =>
  `https://placehold.co/${width}x${height}/png?text=${encodeURIComponent(label)}`

export const mockCafeDesign: WebsiteDesign = {
  schemaVersion: 1,
  businessName: "Sunrise Corner Café",
  tagline: "Small-batch coffee and fresh pastries, baked every morning.",

  theme: {
    colors: {
      primary: "#7A3E1D",
      secondary: "#2F4A3A",
      accent: "#E8A33D",
      background: "#FFF9F1",
      surface: "#FFFFFF",
      text: "#2B1D14",
      mutedText: "#6B5B4E",
    },
    typography: {
      headingFont: "Playfair Display",
      bodyFont: "Inter",
      scale: "comfortable",
    },
  },

  navigation: {
    items: [
      { label: "About", sectionId: "about" },
      { label: "Menu", sectionId: "services" },
      { label: "Gallery", sectionId: "gallery" },
      { label: "Contact", sectionId: "contact" },
    ],
    cta: { label: "Visit Us", sectionId: "contact" },
  },

  hero: {
    headline: "Your neighborhood coffee, made slow and made well",
    subheadline:
      "Locally roasted espresso, warm pastries from our own oven, and a seat by the window. Open every day from 7 AM.",
    primaryCta: { label: "See the Menu", sectionId: "services" },
    secondaryCta: { label: "Find Us", sectionId: "contact" },
    image: {
      src: placeholder(1600, 900, "Cafe interior"),
      alt: "Sunlit cafe interior with wooden tables and a pastry counter",
      width: 1600,
      height: 900,
    },
  },

  about: {
    heading: "A corner of the neighborhood since 2014",
    body: [
      "Sunrise Corner Café started as a two-table coffee counter run by Maria and Daniel Ortega. Ten years later, it is still family-run, and we still know most of our regulars by name.",
      "We roast with a small local roaster, bake our pastries every morning before opening, and buy our produce from farms within an hour of the shop.",
    ],
    highlights: [
      { label: "Serving the neighborhood since", value: "2014" },
      { label: "Pastries baked fresh daily", value: "12+" },
      { label: "Local farms and roasters", value: "6" },
    ],
    image: {
      src: placeholder(900, 1100, "Maria and Daniel"),
      alt: "Maria and Daniel Ortega, the owners, behind the cafe counter",
      width: 900,
      height: 1100,
    },
  },

  services: {
    heading: "What we serve",
    intro: "Everything is made in small batches and sold until it runs out.",
    items: [
      {
        id: "coffee",
        name: "Espresso & Coffee",
        description:
          "Espresso drinks, pour-over, and cold brew made with beans roasted a few miles away.",
        price: "From $3.50",
        image: {
          src: placeholder(800, 600, "Coffee"),
          alt: "A latte with leaf-shaped milk art in a ceramic cup",
        },
      },
      {
        id: "pastries",
        name: "Fresh Pastries",
        description:
          "Butter croissants, seasonal fruit danishes, and our cardamom morning buns.",
        price: "From $4.00",
        image: {
          src: placeholder(800, 600, "Pastries"),
          alt: "A tray of golden croissants and morning buns",
        },
      },
      {
        id: "brunch",
        name: "Breakfast & Brunch",
        description:
          "Egg sandwiches, avocado toast, and a rotating soup and salad lunch special.",
        price: "From $9.00",
        image: {
          src: placeholder(800, 600, "Brunch"),
          alt: "Avocado toast topped with a soft egg on a white plate",
        },
      },
      {
        id: "catering",
        name: "Catering & Orders",
        description:
          "Pastry boxes, coffee service, and sandwich platters for meetings and parties. Order 48 hours ahead.",
        price: "Quote on request",
      },
    ],
  },

  gallery: {
    heading: "Inside the café",
    images: [
      {
        id: "gallery-1",
        src: placeholder(1000, 750, "Front counter"),
        alt: "The front counter with a glass case of pastries",
        caption: "The morning pastry case",
        width: 1000,
        height: 750,
      },
      {
        id: "gallery-2",
        src: placeholder(1000, 750, "Window seats"),
        alt: "Two window seats with coffee cups and a plant",
        caption: "Window seats fill up early",
        width: 1000,
        height: 750,
      },
      {
        id: "gallery-3",
        src: placeholder(1000, 750, "Latte art"),
        alt: "A barista pouring latte art",
        width: 1000,
        height: 750,
      },
      {
        id: "gallery-4",
        src: placeholder(1000, 750, "Patio"),
        alt: "Small outdoor patio with string lights",
        caption: "Our patio, open spring through fall",
        width: 1000,
        height: 750,
      },
    ],
  },

  contact: {
    heading: "Come say hello",
    intro: "Walk-ins are always welcome. For catering, call or email us.",
    address: {
      street: "214 Alder Street",
      city: "Portland",
      region: "OR",
      postalCode: "97205",
      country: "United States",
    },
    phone: "(503) 555-0142",
    email: "hello@sunrisecorner.example",
    openingHours: [
      { days: "Monday to Friday", hours: "7:00 AM - 5:00 PM" },
      { days: "Saturday and Sunday", hours: "8:00 AM - 4:00 PM" },
    ],
  },

  footer: {
    tagline: "Sunrise Corner Café. Coffee, pastries, and good company.",
    links: [
      { label: "About", sectionId: "about" },
      { label: "Menu", sectionId: "services" },
      { label: "Contact", sectionId: "contact" },
    ],
    socialLinks: [
      { platform: "instagram", url: "https://www.instagram.com/sunrisecorner.example" },
      { platform: "facebook", url: "https://www.facebook.com/sunrisecorner.example" },
      { platform: "yelp", url: "https://www.yelp.com/biz/sunrise-corner-cafe-example" },
    ],
    legalText: "All rights reserved.",
  },

  sections: [
    { id: "hero", type: "hero", visible: true },
    { id: "about", type: "about", visible: true },
    { id: "services", type: "services", visible: true },
    { id: "gallery", type: "gallery", visible: true },
    { id: "contact", type: "contact", visible: true },
  ],
}

/**
 * Turns a site hostname into a stable, URL-safe id,
 * e.g. "https://www.My-Cafe.com/menu" -> "proj_my-cafe-com".
 */
function projectIdFor(url: URL): string {
  const slug = url.hostname
    .replace(/^www\./, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `proj_${slug}`
}

/**
 * Mock of the future "redesign this website" backend call.
 *
 * It does not fetch the URL. It only checks the URL is a valid http(s) URL and
 * always returns the sample cafe design. The async signature and return shape
 * match what the real API call will look like, so callers will not need to
 * change when this is replaced.
 */
export async function mockRedesign(url: string): Promise<RedesignResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("mockRedesign expects a valid http(s) URL.")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("mockRedesign expects a valid http(s) URL.")
  }

  return {
    projectId: projectIdFor(parsed),
    // Local sample image (public/samples). A real backend will return a URL
    // to a captured screenshot instead.
    originalScreenshotUrl: "/samples/original-website.svg",
    // Copy so callers can edit the result without changing the shared sample.
    content: { kind: "design", design: structuredClone(mockCafeDesign) },
  }
}
