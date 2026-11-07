"use client"

import { SafeImage } from "@/components/site-revive/safe-image"
import {
  HEADING_FONT,
  SectionHeading,
  WebsiteSection,
} from "@/components/site-revive/website-section"
import { cn } from "@/lib/utils"
import type { AboutContent } from "@/types/website"

type WebsiteAboutProps = {
  sectionId: string
  content: AboutContent
}

export function WebsiteAbout({ sectionId, content }: WebsiteAboutProps) {
  const { image } = content

  return (
    <WebsiteSection
      sectionId={sectionId}
      label={content.heading}
      className="bg-(--sr-surface)"
    >
      <div
        className={cn(
          "grid items-center gap-10 @4xl:gap-16",
          image && "@4xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
        )}
      >
        {image ? (
          <SafeImage
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            className="aspect-[4/5] w-full max-w-md rounded-3xl object-cover shadow-lg @4xl:max-w-none"
          />
        ) : null}

        <div>
          <SectionHeading className="mb-6 @2xl:mb-8">{content.heading}</SectionHeading>
          <div className="space-y-5 text-lg leading-8 text-(--sr-muted)">
            {content.body.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          {content.highlights.length > 0 ? (
            <dl className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-6 border-t border-(--sr-border) pt-8">
              {content.highlights.map((highlight) => (
                <div key={highlight.label} className="flex flex-col">
                  <dt className="order-2 mt-1 text-sm text-(--sr-muted)">
                    {highlight.label}
                  </dt>
                  <dd
                    className={cn(
                      "order-1 text-4xl font-semibold text-(--sr-primary)",
                      HEADING_FONT
                    )}
                  >
                    {highlight.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </WebsiteSection>
  )
}
