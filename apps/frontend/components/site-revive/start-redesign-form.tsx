"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

import { UrlForm, type ValidUrlSubmission } from "@/components/capture/url-form"

/** Longest the form keeps its loading state if navigation never completes. */
const NAVIGATION_TIMEOUT_MS = 10_000

type StartRedesignFormProps = {
  className?: string
}

/**
 * Landing-page form: validates the URL (via UrlForm), then moves on to the
 * processing screen. The landing page is a server component and cannot pass a
 * function to UrlForm, so this client wrapper supplies `onValidSubmit`.
 */
export function StartRedesignForm({ className }: StartRedesignFormProps) {
  const router = useRouter()
  const releaseRef = useRef<(() => void) | null>(null)

  // UrlForm shows its loading state until the promise returned by
  // `onValidSubmit` settles. Next.js keeps this page mounted but hidden after
  // navigating away, so release the loading state when that happens. Pressing
  // Back then shows a usable form instead of a stuck disabled button.
  useEffect(() => {
    return () => {
      releaseRef.current?.()
      releaseRef.current = null
    }
  }, [])

  function handleValidSubmit({ url }: ValidUrlSubmission) {
    router.push(`/redesign?url=${encodeURIComponent(url)}`)

    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, NAVIGATION_TIMEOUT_MS)
      releaseRef.current = () => {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  return <UrlForm className={className} onValidSubmit={handleValidSubmit} />
}
