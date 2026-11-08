"use client"

import { useEffect, useRef, useState } from "react"
import { Link2Off } from "lucide-react"

import {
  PAGE_SANDBOX,
  buildPageDocument,
  pageContentKey,
  parseFrameMessage,
} from "@/lib/generated-page"
import type { GeneratedPage } from "@/types/website"

type GeneratedPageFrameProps = {
  page: GeneratedPage
  /** The original site's address. Relative image and link URLs in the page resolve against it. */
  baseUrl?: string | null
  /** Accessible name, e.g. "Example Cafe website preview". */
  title: string
  className?: string
}

/**
 * Shows an AI-written page as a working website, isolated from this app.
 *
 * The page's HTML, CSS and JavaScript are placed in a sandboxed <iframe>
 * (`sandbox="allow-scripts"`, no `allow-same-origin`) whose document carries its
 * own Content-Security-Policy, which permits only the two scripts built for it;
 * see lib/generated-page.ts for exactly what that allows and blocks. Nothing from the page is ever inserted into this app's DOM.
 *
 * A changed page always gets a brand-new frame (the key is a fingerprint of the
 * code), so the previous page's scripts, timers and listeners are destroyed with
 * its frame and can never mix with the new page.
 */
export function GeneratedPageFrame(props: GeneratedPageFrameProps) {
  return <PageFrame key={`${pageContentKey(props.page)}|${props.baseUrl ?? ""}`} {...props} />
}

const NOTICE_MS = 4000

function PageFrame({ page, baseUrl, title, className }: GeneratedPageFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Built once for the life of this frame (the key above remounts this component
  // whenever the page changes). `null` during server rendering.
  const [built] = useState<{ doc: string } | { error: string } | null>(() => {
    if (typeof window === "undefined") return null
    try {
      return {
        doc: buildPageDocument(page, {
          baseUrl,
          parentOrigin: window.location.origin,
        }),
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "The page could not be shown." }
    }
  })

  // Messages from the page (a blocked link, a script error). Anything that does
  // not come from this frame's own window, or is not one of our two message
  // shapes, is ignored.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return
      const message = parseFrameMessage(event.data)
      if (!message) return
      if (message.type === "link") {
        setNotice("This preview doesn't open other websites.")
      } else if (process.env.NODE_ENV !== "production") {
        console.warn(`[SiteRevive preview] The generated page reported an error: ${message.value}`)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  if (built === null) return null

  if ("error" in built) {
    return (
      <div role="alert" className="flex h-full items-center justify-center bg-white p-6 text-center text-sm text-neutral-700">
        This page could not be shown safely, so it was not loaded.
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <iframe
        ref={frameRef}
        title={title}
        sandbox={PAGE_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={built.doc}
        className={className ?? "h-full w-full border-0 bg-white"}
      />
      {notice ? (
        <p
          role="status"
          className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-md bg-black/80 px-3 py-1.5 text-xs font-medium text-white"
        >
          <Link2Off className="size-3.5" aria-hidden />
          {notice}
        </p>
      ) : null}
    </div>
  )
}
