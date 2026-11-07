"use client"

import { SafeImage } from "@/components/site-revive/safe-image"
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  HEADING_FONT,
  SectionLink,
  WebsiteSection,
} from "@/components/site-revive/website-section"
import { cn } from "@/lib/utils"
import type { HeroContent } from "@/types/website"

type WebsiteHeroProps = {
  sectionId: string
  businessName: string
  content: HeroContent
}

export function WebsiteHero({ sectionId, businessName, content }: WebsiteHeroProps) {
  return (
    <WebsiteSection
      sectionId={sectionId}
      label={businessName}
      className="overflow-hidden bg-(--sr-bg)"
    >
      <div className="grid items-center gap-10 @4xl:grid-cols-2 @4xl:gap-14">
        <div>
          <p className="mb-5 inline-flex rounded-full bg-(--sr-accent)/20 px-4 py-1.5 text-xs font-semibold tracking-widest text-(--sr-primary) uppercase">
            {businessName}
          </p>
          {/* h2: the page that embeds this website already owns the h1. */}
          <h2
            className={cn(
              "text-4xl leading-[1.1] font-semibold tracking-tight text-balance text-(--sr-text) @2xl:text-5xl @4xl:text-6xl",
              HEADING_FONT
            )}
          >
            {content.headline}
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-8 text-pretty text-(--sr-muted) @2xl:text-xl @2xl:leading-9">
            {content.subheadline}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <SectionLink
              sectionId={content.primaryCta.sectionId}
              className={BUTTON_PRIMARY}
            >
              {content.primaryCta.label}
            </SectionLink>
            {content.secondaryCta ? (
              <SectionLink
                sectionId={content.secondaryCta.sectionId}
                className={BUTTON_SECONDARY}
              >
                {content.secondaryCta.label}
              </SectionLink>
            ) : null}
          </div>
        </div>

        <div className="relative">
          <div
            aria-hidden
            className="absolute -inset-3 rotate-2 rounded-[2rem] bg-(--sr-accent)/25"
          />
          <SafeImage
            src={content.image.src}
            alt={content.image.alt}
            width={content.image.width}
            height={content.image.height}
            priority
            className="relative aspect-[4/3] w-full rounded-3xl object-cover shadow-xl"
          />
        </div>
      </div>
    </WebsiteSection>
  )
}
