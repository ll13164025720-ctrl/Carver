import type { Metadata } from "next"

import { SiteHeader } from "@/components/landing/site-header"
import { PreviewWorkspace } from "@/components/site-revive/preview-workspace"

export const metadata: Metadata = {
  title: "Your redesign preview | CARVER",
  robots: { index: false },
}

export default function PreviewPage() {
  return (
    <div className="flex flex-1 flex-col bg-forest text-cream">
      <SiteHeader showNav={false} className="max-w-[1600px] px-4 sm:px-6" />
      <PreviewWorkspace />
    </div>
  )
}
