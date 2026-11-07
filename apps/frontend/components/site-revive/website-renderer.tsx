"use client"

import { Fragment, useCallback, useMemo, useRef, type ReactNode } from "react"

import {
  RendererProvider,
  type RendererContextValue,
} from "@/components/site-revive/renderer-context"
import { WebsiteAbout } from "@/components/site-revive/website-about"
import { WebsiteContact } from "@/components/site-revive/website-contact"
import { WebsiteFooter } from "@/components/site-revive/website-footer"
import { WebsiteGallery } from "@/components/site-revive/website-gallery"
import { WebsiteHero } from "@/components/site-revive/website-hero"
import { WebsiteNavbar } from "@/components/site-revive/website-navbar"
import { WebsiteServices } from "@/components/site-revive/website-services"
import { buildThemeStyle, sectionPaddingFor } from "@/lib/website-render"
import { cn } from "@/lib/utils"
import type { SectionConfig, WebsiteDesign } from "@/types/website"

type WebsiteRendererProps = {
  design: WebsiteDesign
  /**
   * The renderer is its own scroll container, so give it a height
   * (e.g. "h-full" inside a sized frame). Its layout responds to its own width.
   */
  className?: string
}

function renderSection(section: SectionConfig, design: WebsiteDesign): ReactNode {
  switch (section.type) {
    case "hero":
      return (
        <WebsiteHero
          sectionId={section.id}
          businessName={design.businessName}
          content={design.hero}
        />
      )
    case "about":
      return <WebsiteAbout sectionId={section.id} content={design.about} />
    case "services":
      return <WebsiteServices sectionId={section.id} content={design.services} />
    case "gallery":
      return <WebsiteGallery sectionId={section.id} content={design.gallery} />
    case "contact":
      return <WebsiteContact sectionId={section.id} content={design.contact} />
    default:
      // A newer backend may send a section type this version does not know.
      // Skipping it keeps the rest of the website working.
      return null
  }
}

/**
 * Renders a complete website from a WebsiteDesign. All content, colours, fonts,
 * section order and visibility come from the JSON. Nothing about a specific
 * business lives in the renderer.
 */
export function WebsiteRenderer({ design, className }: WebsiteRendererProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  const visibleSections = useMemo(
    () => design.sections.filter((section) => section.visible),
    [design.sections]
  )
  const themeStyle = useMemo(() => buildThemeStyle(design.theme), [design.theme])
  const sectionPadding = sectionPaddingFor(design.theme?.typography?.scale)

  const hasSection = useCallback(
    (sectionId: string) =>
      visibleSections.some((section) => section.id === sectionId),
    [visibleSections]
  )

  const navigateTo = useCallback((sectionId: string) => {
    const root = rootRef.current
    if (!root) return

    // Compare ids in code instead of building a selector from design data.
    const target = Array.from(
      root.querySelectorAll<HTMLElement>("[data-section-id]")
    ).find((element) => element.dataset.sectionId === sectionId)
    if (!target) return

    const navbarHeight =
      root.querySelector<HTMLElement>("[data-navbar]")?.offsetHeight ?? 0
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    root.scrollTo({
      top: target.offsetTop - navbarHeight,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    })
  }, [])

  const context = useMemo<RendererContextValue>(
    () => ({ sectionPadding, hasSection, navigateTo }),
    [sectionPadding, hasSection, navigateTo]
  )

  return (
    <RendererProvider value={context}>
      <div
        ref={rootRef}
        role="region"
        // Keyboard users need to focus the scroll area to scroll it.
        tabIndex={0}
        aria-label={`${design.businessName} website preview`}
        style={themeStyle}
        className={cn(
          "@container relative overflow-y-auto bg-(--sr-bg) text-(--sr-text) antialiased [font-family:var(--sr-body-font)]",
          className
        )}
      >
        <WebsiteNavbar
          businessName={design.businessName}
          content={design.navigation}
        />
        <main>
          {visibleSections.map((section) => (
            <Fragment key={section.id}>{renderSection(section, design)}</Fragment>
          ))}
        </main>
        <WebsiteFooter businessName={design.businessName} content={design.footer} />
      </div>
    </RendererProvider>
  )
}
