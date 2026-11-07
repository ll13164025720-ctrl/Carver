"use client"

import { useId, useState } from "react"
import { Menu, X } from "lucide-react"

import { useRenderer } from "@/components/site-revive/renderer-context"
import {
  BUTTON_PRIMARY,
  HEADING_FONT,
  SectionLink,
} from "@/components/site-revive/website-section"
import { cn } from "@/lib/utils"
import type { NavigationContent } from "@/types/website"

type WebsiteNavbarProps = {
  businessName: string
  content: NavigationContent
}

const LINK_CLASS =
  "rounded-md text-sm font-medium text-(--sr-muted) transition-colors outline-none hover:text-(--sr-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--sr-accent)"

export function WebsiteNavbar({ businessName, content }: WebsiteNavbarProps) {
  const { hasSection } = useRenderer()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()

  const items = content.items.filter((item) => hasSection(item.sectionId))
  const cta =
    content.cta && hasSection(content.cta.sectionId) ? content.cta : undefined
  const hasMenu = items.length > 0 || cta !== undefined

  return (
    <header
      data-navbar
      className="sticky top-0 z-20 border-b border-(--sr-border) bg-(--sr-bg)/90 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 @2xl:px-8">
        <span
          className={cn(
            "text-xl font-semibold tracking-tight text-(--sr-text)",
            HEADING_FONT
          )}
        >
          {businessName}
        </span>

        {hasMenu ? (
          <>
            <nav
              aria-label={`${businessName} navigation`}
              className="hidden items-center gap-7 @2xl:flex"
            >
              {items.map((item) => (
                <SectionLink
                  key={`${item.sectionId}-${item.label}`}
                  sectionId={item.sectionId}
                  className={LINK_CLASS}
                >
                  {item.label}
                </SectionLink>
              ))}
              {cta ? (
                <SectionLink
                  sectionId={cta.sectionId}
                  className={cn(BUTTON_PRIMARY, "px-5 py-2")}
                >
                  {cta.label}
                </SectionLink>
              ) : null}
            </nav>

            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex size-10 items-center justify-center rounded-lg text-(--sr-text) outline-none hover:bg-(--sr-text)/5 focus-visible:outline-2 focus-visible:outline-(--sr-accent) @2xl:hidden"
            >
              {menuOpen ? (
                <X className="size-5" aria-hidden />
              ) : (
                <Menu className="size-5" aria-hidden />
              )}
            </button>
          </>
        ) : null}
      </div>

      {hasMenu && menuOpen ? (
        <nav
          id={menuId}
          aria-label={`${businessName} menu`}
          className="flex flex-col gap-1 border-t border-(--sr-border) px-5 py-3 @2xl:hidden"
        >
          {items.map((item) => (
            <SectionLink
              key={`${item.sectionId}-${item.label}`}
              sectionId={item.sectionId}
              onNavigate={() => setMenuOpen(false)}
              className={cn(LINK_CLASS, "px-2 py-3 text-base")}
            >
              {item.label}
            </SectionLink>
          ))}
          {cta ? (
            <SectionLink
              sectionId={cta.sectionId}
              onNavigate={() => setMenuOpen(false)}
              className={cn(BUTTON_PRIMARY, "mt-2")}
            >
              {cta.label}
            </SectionLink>
          ) : null}
        </nav>
      ) : null}
    </header>
  )
}
