"use client"

import { SafeImage } from "@/components/site-revive/safe-image"
import { isMockMode } from "@/lib/site-revive-api"

type OriginalSiteViewProps = {
  /** Screenshot URL from the redesign result. */
  screenshotUrl: string
}

/**
 * The "Before" side: a screenshot image of the original website, shown in a
 * scrollable box. The original site itself is never embedded in an iframe.
 * In demo mode the image is a local, labeled placeholder.
 */
export function OriginalSiteView({ screenshotUrl }: OriginalSiteViewProps) {
  const mockMode = isMockMode()
  return (
    <div className="relative h-full bg-neutral-200">
      <div
        role="region"
        tabIndex={0}
        aria-label={
          mockMode
            ? "Original website screenshot (sample placeholder)"
            : "Original website screenshot"
        }
        className="h-full overflow-y-auto"
      >
        <SafeImage
          src={screenshotUrl}
          alt={
            mockMode
              ? "Sample placeholder screenshot of an outdated website, not your real site"
              : "Screenshot of the original website"
          }
          className="block h-auto w-full"
          fallbackClassName="min-h-full text-sm text-neutral-600"
        />
      </div>
      {mockMode ? (
        <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-forest/90 px-3 py-1 text-xs font-medium text-cream">
          Sample screenshot (placeholder)
        </p>
      ) : null}
    </div>
  )
}
