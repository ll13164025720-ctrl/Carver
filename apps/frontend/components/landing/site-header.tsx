import Link from "next/link"

import { cn } from "@/lib/utils"

type SiteHeaderProps = {
  className?: string
}

export function SiteHeader({ className }: SiteHeaderProps) {
  return (
    <header
      className={cn(
        "mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5",
        className
      )}
    >
      <Link
        href="/"
        className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-white/50"
        aria-label="SiteRevive home"
      >
        {/* Logo slot: replace this placeholder with the SiteRevive logo
            (e.g. <Image src="/logo.svg" width={32} height={32} alt="" />). */}
        <span
          aria-hidden
          className="size-8 shrink-0 rounded-lg border border-dashed border-white/30"
        />
        <span className="text-lg font-semibold tracking-tight">SiteRevive</span>
      </Link>

      <nav aria-label="Main">
        <a
          href="#how-it-works"
          className="rounded-md text-sm font-medium text-white/70 transition-colors outline-none hover:text-white focus-visible:ring-3 focus-visible:ring-white/50"
        >
          How it works
        </a>
      </nav>
    </header>
  )
}
