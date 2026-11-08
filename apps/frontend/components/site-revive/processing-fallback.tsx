import { LoaderCircle } from "lucide-react"

/** Shown while the /redesign client component loads (Suspense fallback). */
export function ProcessingFallback() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <p role="status" className="flex items-center gap-3 text-cream/75">
        <LoaderCircle
          className="size-5 text-gold motion-safe:animate-spin"
          aria-hidden
        />
        Loading...
      </p>
    </main>
  )
}
