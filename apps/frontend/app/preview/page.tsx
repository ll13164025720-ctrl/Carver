import type { Metadata } from "next"

import { SiteHeader } from "@/components/landing/site-header"
import { PreviewWorkspace } from "@/components/site-revive/preview-workspace"

export const metadata: Metadata = {
  title: "Your redesign preview | SiteRevive",
  robots: { index: false },
}

export default function PreviewPage() {
  return (
    <div className="flex flex-1 flex-col bg-black text-white">
      <SiteHeader showNav={false} className="max-w-[1600px] px-4 sm:px-6" />
      <PreviewWorkspace />
    </div>
  )
}
