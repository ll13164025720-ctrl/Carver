/**
 * Data contract of the SiteRevive backend (apps/backend + apps/capture-worker).
 *
 * These types mirror the Zod schemas in packages/shared/src/index.ts, which is
 * the source of truth. They are plain types on purpose: the frontend does not
 * import the workspace package, and everything arriving from the network is
 * validated by `parseBlueprint` / `parseCapture` in lib/blueprint-adapter.ts
 * before it is treated as one of these types.
 *
 * Do not render these shapes directly. The UI renders `WebsiteDesign`
 * (types/website.ts); lib/blueprint-adapter.ts converts between the two.
 */

export type BlueprintSectionType =
  | "header"
  | "hero"
  | "about"
  | "menu"
  | "contact"
  | "footer"

export interface BlueprintSection {
  /** 1-80 characters. Not guaranteed unique by the backend. */
  id: string
  type: BlueprintSectionType
  visible: boolean
  /**
   * Free-form on purpose: the backend only checks that this is an object. The
   * fields the model is asked to produce per type are listed in
   * apps/backend/src/handler.ts, but any of them may be missing, empty, or the
   * wrong type, especially after a prompt edit.
   */
  content: Record<string, unknown>
}

export interface BlueprintTheme {
  /** "#RRGGBB" */
  primaryColor: string
  /** "#RRGGBB" */
  secondaryColor: string
  fontFamily: string
}

/** `blueprint` in the responses of /api/blueprints/generate and /edit. */
export interface WebsiteBlueprint {
  schemaVersion: "1.0"
  siteId: string
  /** Lowercase letters, digits and hyphens. */
  slug: string
  businessName: string
  description: string
  theme: BlueprintTheme
  /** 3 to 12 sections. */
  sections: BlueprintSection[]
}

/** `capture` in the response of /api/captures. */
export interface WebsiteCapture {
  captureId: string
  sourceUrl: string
  finalUrl: string
  capturedAt: string
  title: string
  description: string
  headings: Array<{ level: number; text: string }>
  text: string
  links: Array<{ text: string; url: string }>
  images: Array<{ src: string; alt: string }>
  /** Absolute URLs when the backend has CAPTURE_WORKER_PUBLIC_URL set, otherwise paths like "/artifacts/<id>-desktop.png". */
  screenshots: { desktop: string; mobile: string }
}
