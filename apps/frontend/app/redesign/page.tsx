import { Suspense } from "react"
import type { Metadata } from "next"

import { SiteHeader } from "@/components/landing/site-header"
import { ProcessingFallback } from "@/components/site-revive/processing-fallback"
import { RedesignProcessor } from "@/components/site-revive/redesign-processor"

export const metadata: Metadata = {
  title: "Reviving your website | CARVER",
  robots: { index: false },
}

export default function RedesignPage() {
  return (
    <div className="flex flex-1 flex-col bg-forest text-cream">
      <SiteHeader showNav={false} />
      {/* useSearchParams() in RedesignProcessor requires a Suspense boundary. */}
      <Suspense fallback={<ProcessingFallback />}>
        <RedesignProcessor />
      </Suspense>
    </div>
  )
}
