"use client"

import { SafeImage } from "@/components/site-revive/safe-image"

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
  return (
    <div className="relative h-full bg-neutral-200">
      <div
        role="region"
        tabIndex={0}
        aria-label="Original website screenshot (sample placeholder)"
        className="h-full overflow-y-auto"
      >
        <SafeImage
          src={screenshotUrl}
          alt="Sample placeholder screenshot of an outdated website, not your real site"
          className="block h-auto w-full"
          fallbackClassName="min-h-full text-sm text-neutral-600"
        />
      </div>
      <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/75 px-3 py-1 text-xs font-medium text-white">
        Sample screenshot (placeholder)
      </p>
    </div>
  )
}
