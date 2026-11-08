"use client"

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"

import { UrlForm, type ValidUrlSubmission } from "@/components/capture/url-form"
import { parseDraft, readDraftJson, saveDraft } from "@/lib/redesign-draft"

/** Longest the form keeps its loading state if navigation never completes. */
const NAVIGATION_TIMEOUT_MS = 10_000

type StartRedesignFormProps = {
  className?: string
}

// Session storage cannot change while this page is open, so nothing to watch.
const subscribeToNothing = () => () => {}
// null on the server and during hydration, so the first render matches the server's.
const readOnServer = (): string | null => null

/**
 * Landing-page form: validates the URL (via UrlForm), then moves on to the
 * processing screen. The landing page is a server component and cannot pass a
 * function to UrlForm, so this client wrapper supplies `onValidSubmit`.
 */
export function StartRedesignForm({ className }: StartRedesignFormProps) {
  const router = useRouter()
  const releaseRef = useRef<(() => void) | null>(null)

  // What the user typed before a failed attempt, so they can retry or change the
  // address without retyping. The form is re-created (see `key`) once the saved
  // values are known, because it only reads its initial values once.
  const draftJson = useSyncExternalStore(subscribeToNothing, readDraftJson, readOnServer)
  const draft = useMemo(() => parseDraft(draftJson), [draftJson])

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

  function handleValidSubmit({ url, instruction }: ValidUrlSubmission) {
    // The design direction travels in this tab's sessionStorage, not the address
    // bar, so it does not end up in browser history or server logs.
    saveDraft({ url, instruction })
    router.push(`/redesign?url=${encodeURIComponent(url)}`)

    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, NAVIGATION_TIMEOUT_MS)
      releaseRef.current = () => {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  return (
    <UrlForm
      key={draft ? "draft" : "empty"}
      className={className}
      onValidSubmit={handleValidSubmit}
      initialUrl={draft?.url}
      initialInstruction={draft?.instruction}
    />
  )
}
