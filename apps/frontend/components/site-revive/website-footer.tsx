"use client"

import { HEADING_FONT, SectionLink } from "@/components/site-revive/website-section"
import { safeExternalHref } from "@/lib/website-render"
import { cn } from "@/lib/utils"
import type { FooterContent, SocialPlatform } from "@/types/website"

type WebsiteFooterProps = {
  businessName: string
  content: FooterContent
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  tiktok: "TikTok",
  yelp: "Yelp",
  linkedin: "LinkedIn",
  youtube: "YouTube",
}

const LINK_CLASS =
  "rounded text-sm text-(--sr-bg)/75 outline-none transition-colors hover:text-(--sr-bg) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--sr-accent)"

export function WebsiteFooter({ businessName, content }: WebsiteFooterProps) {
  // Social links are external. Anything that is not a plain http(s) URL is dropped.
  const socialLinks = content.socialLinks.flatMap((link) => {
    const href = safeExternalHref(link.url)
    return href ? [{ platform: link.platform, href }] : []
  })

  return (
    <footer className="bg-(--sr-text) text-(--sr-bg)">
      <div className="mx-auto w-full max-w-6xl px-5 py-12 @2xl:px-8 @2xl:py-16">
        <div className="flex flex-col gap-10 @2xl:flex-row @2xl:justify-between">
          <div className="max-w-sm">
            <p className={cn("text-2xl font-semibold", HEADING_FONT)}>
              {businessName}
            </p>
            {content.tagline ? (
              <p className="mt-3 leading-7 text-(--sr-bg)/70">{content.tagline}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-x-16 gap-y-8">
            <nav aria-label={`${businessName} footer`}>
              <ul className="flex flex-col gap-3">
                {content.links.map((link) => (
                  <li key={`${link.sectionId}-${link.label}`}>
                    <SectionLink sectionId={link.sectionId} className={LINK_CLASS}>
                      {link.label}
                    </SectionLink>
                  </li>
                ))}
              </ul>
            </nav>

            {socialLinks.length > 0 ? (
              <ul aria-label="Social media" className="flex flex-col gap-3">
                {socialLinks.map((link) => (
                  <li key={link.platform}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={LINK_CLASS}
                    >
                      {PLATFORM_LABELS[link.platform] ?? link.platform}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <p className="mt-12 border-t border-(--sr-bg)/15 pt-6 text-sm text-(--sr-bg)/60">
          &copy; {businessName}. {content.legalText}
        </p>
      </div>
    </footer>
  )
}
