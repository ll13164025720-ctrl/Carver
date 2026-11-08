import Image from "next/image"
import Link from "next/link"

import { cn } from "@/lib/utils"

type SiteHeaderProps = {
  className?: string
  /** Show the in-page "How it works" link. Only valid on the landing page. */
  showNav?: boolean
}

export function SiteHeader({ className, showNav = true }: SiteHeaderProps) {
  return (
    <header
      className={cn(
        "mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 sm:px-8 sm:py-8",
        className
      )}
    >
      <Link
        href="/"
        className="cv-link -ml-1 flex items-center p-1"
        aria-label="CARVER home"
      >
        {/* Transparent-background wordmark, so it sits directly on the green. */}
        <Image
          src="/carver-logo-on-dark.svg"
          alt="CARVER"
          width={3188}
          height={755}
          priority
          unoptimized
          className="h-8 w-auto sm:h-9"
        />
      </Link>

      {showNav ? (
        <nav aria-label="Main">
          <a href="#how-it-works" className="cv-link text-sm font-medium">
            How it works
          </a>
        </nav>
      ) : null}
    </header>
  )
}
