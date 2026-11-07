import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Shown when /preview is opened without a redesign result in this tab. */
export function PreviewEmptyState() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        There&apos;s no preview to show yet
      </h1>
      <p className="mt-4 text-lg leading-8 text-white/70">
        Previews are kept only for the current browser tab. Enter your website
        address to create a new one.
      </p>
      <Link
        href="/"
        className={cn(
          buttonVariants({ size: "lg" }),
          "mt-8 h-12 w-fit rounded-xl bg-violet-600 px-6 text-base font-semibold text-white shadow-lg shadow-violet-600/30 hover:bg-violet-500"
        )}
      >
        Revive a website
        <ArrowRight aria-hidden data-icon="inline-end" />
      </Link>
    </main>
  )
}
