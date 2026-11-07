"use client"

import { SafeImage } from "@/components/site-revive/safe-image"
import {
  HEADING_FONT,
  SectionHeading,
  WebsiteSection,
} from "@/components/site-revive/website-section"
import { cn } from "@/lib/utils"
import type { ServicesContent } from "@/types/website"

type WebsiteServicesProps = {
  sectionId: string
  content: ServicesContent
}

export function WebsiteServices({ sectionId, content }: WebsiteServicesProps) {
  return (
    <WebsiteSection
      sectionId={sectionId}
      label={content.heading}
      className="bg-(--sr-bg)"
    >
      <SectionHeading intro={content.intro}>{content.heading}</SectionHeading>

      {/* auto-fit: any number of items fills the row and wraps to the width. */}
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-6">
        {content.items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col overflow-hidden rounded-3xl border border-(--sr-border) bg-(--sr-surface) shadow-sm"
          >
            {item.image ? (
              <SafeImage
                src={item.image.src}
                alt={item.image.alt}
                width={item.image.width}
                height={item.image.height}
                className="aspect-[4/3] w-full object-cover"
              />
            ) : null}
            <div className="flex flex-1 flex-col p-6">
              <div className="flex items-start justify-between gap-3">
                <h3
                  className={cn(
                    "text-xl font-semibold text-(--sr-text)",
                    HEADING_FONT
                  )}
                >
                  {item.name}
                </h3>
                {item.price ? (
                  <span className="shrink-0 rounded-full bg-(--sr-accent) px-3 py-1 text-xs font-semibold text-(--sr-on-accent)">
                    {item.price}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 leading-7 text-(--sr-muted)">{item.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </WebsiteSection>
  )
}
