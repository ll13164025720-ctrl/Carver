"use client"

import type { ReactNode } from "react"

import { useRenderer } from "@/components/site-revive/renderer-context"
import { cn } from "@/lib/utils"

/**
 * Building blocks shared by the website section components. Everything here
 * styles itself from the `--sr-*` theme variables set by <WebsiteRenderer>,
 * and uses container queries (`@2xl:` etc.) so layouts follow the width of the
 * frame the website is shown in, not the browser window.
 */

/** Heading typeface from the design's theme. */
export const HEADING_FONT = "[font-family:var(--sr-heading-font)]"

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--sr-accent)"

export const BUTTON_PRIMARY = cn(
  BUTTON_BASE,
  "bg-(--sr-primary) text-(--sr-on-primary) shadow-sm hover:opacity-90"
)

export const BUTTON_SECONDARY = cn(
  BUTTON_BASE,
  "border border-(--sr-text)/25 text-(--sr-text) hover:bg-(--sr-text)/5"
)

type WebsiteSectionProps = {
  /** The id from `design.sections`. Used for navigation. */
  sectionId: string
  /** Accessible name for the section. */
  label: string
  className?: string
  children: ReactNode
}

export function WebsiteSection({
  sectionId,
  label,
  className,
  children,
}: WebsiteSectionProps) {
  const { sectionPadding } = useRenderer()
  return (
    <section
      data-section-id={sectionId}
      aria-label={label}
      className={cn(sectionPadding, className)}
    >
      <div className="mx-auto w-full max-w-6xl px-5 @2xl:px-8">{children}</div>
    </section>
  )
}

type SectionHeadingProps = {
  children: ReactNode
  intro?: string
  className?: string
}

export function SectionHeading({ children, intro, className }: SectionHeadingProps) {
  return (
    <div className={cn("mb-10 max-w-2xl @2xl:mb-14", className)}>
      <h2
        className={cn(
          "text-3xl font-semibold tracking-tight text-balance text-(--sr-text) @2xl:text-4xl",
          HEADING_FONT
        )}
      >
        {children}
      </h2>
      {intro ? (
        <p className="mt-4 text-lg leading-8 text-(--sr-muted)">{intro}</p>
      ) : null}
    </div>
  )
}

type SectionLinkProps = {
  sectionId: string
  className?: string
  children: ReactNode
  onNavigate?: () => void
}

/**
 * A link to another section of the same website. It scrolls the website, not
 * the surrounding page, and renders nothing if the target section is hidden or
 * does not exist, so a design can never show a dead link.
 */
export function SectionLink({
  sectionId,
  className,
  children,
  onNavigate,
}: SectionLinkProps) {
  const { hasSection, navigateTo } = useRenderer()
  if (!hasSection(sectionId)) return null

  return (
    <a
      href={`#${encodeURIComponent(sectionId)}`}
      className={className}
      onClick={(event) => {
        event.preventDefault()
        navigateTo(sectionId)
        onNavigate?.()
      }}
    >
      {children}
    </a>
  )
}
