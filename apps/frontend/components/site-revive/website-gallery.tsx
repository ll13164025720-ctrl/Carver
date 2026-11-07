"use client"

import { SafeImage } from "@/components/site-revive/safe-image"
import {
  SectionHeading,
  WebsiteSection,
} from "@/components/site-revive/website-section"
import type { GalleryContent } from "@/types/website"

type WebsiteGalleryProps = {
  sectionId: string
  content: GalleryContent
}

export function WebsiteGallery({ sectionId, content }: WebsiteGalleryProps) {
  return (
    <WebsiteSection
      sectionId={sectionId}
      label={content.heading}
      className="bg-(--sr-surface)"
    >
      <SectionHeading>{content.heading}</SectionHeading>

      <ul className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4 @2xl:gap-6">
        {content.images.map((image) => (
          <li key={image.id}>
            <figure>
              <SafeImage
                src={image.src}
                alt={image.alt}
                width={image.width}
                height={image.height}
                className="aspect-[4/3] w-full rounded-2xl object-cover shadow-sm"
              />
              {image.caption ? (
                <figcaption className="mt-3 text-sm text-(--sr-muted)">
                  {image.caption}
                </figcaption>
              ) : null}
            </figure>
          </li>
        ))}
      </ul>
    </WebsiteSection>
  )
}
