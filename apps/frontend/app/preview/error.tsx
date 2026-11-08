"use client"

import Link from "next/link"
import { RotateCcw } from "lucide-react"

import { SiteHeader } from "@/components/landing/site-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Shown if the preview crashes, for example because a saved or future backend
 * design has an unexpected shape. The rest of the site keeps working.
 */
export default function PreviewError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-1 flex-col bg-forest text-cream">
      <SiteHeader showNav={false} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
        <h1 className="cv-heading text-3xl text-balance sm:text-5xl">
          We couldn&apos;t display this preview
        </h1>
        <p role="alert" className="mt-4 text-lg leading-8 text-cream/75">
          The design data looks unexpected. Try again, or start over with your
          website address.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            size="lg"
            onClick={reset}
            className="cv-btn cv-btn-primary"
          >
            <RotateCcw aria-hidden data-icon="inline-start" />
            Try again
          </Button>
          <Link
            href="/"
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "cv-btn cv-btn-secondary"
            )}
          >
            Back to home
          </Link>
        </div>
      </main>
    </div>
  )
}
