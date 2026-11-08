"use client"

import { useEffect, useRef, useState } from "react"
import {
  Check,
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  LoaderCircle,
  Rocket,
} from "lucide-react"

import {
  describeApiError,
  downloadWebsite,
  fetchPublishState,
  publishWebsite,
  unpublishWebsite,
  type PublishState,
} from "@/lib/site-revive-api"
import { cn } from "@/lib/utils"

type PublishPanelProps = {
  projectId: string
  /** The version on screen. This is the one that gets published or downloaded. */
  shownVersion: number
  /** The newest saved version. */
  latestVersion: number
  className?: string
}

type Loaded =
  | { key: string; state: PublishState }
  | { key: string; error: string }

type Busy = "publish" | "unpublish" | "download" | null

const CHIP =
  "inline-flex items-center gap-2 rounded-md border border-cream/25 px-3 py-2 text-sm text-cream/85 transition-colors outline-none hover:border-cream/50 hover:bg-cream/[0.08] hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:pointer-events-none disabled:opacity-50"

function formatTime(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

/**
 * Lets the owner put the redesigned website online by themselves, or take the
 * file and host it anywhere:
 *
 * - Publish: a snapshot of the version on screen goes live at a public link.
 *   Later edits do not change the live site until it is published again.
 * - Unpublish: takes the link offline. Saved versions are kept.
 * - Download: the same page as one standalone .html file.
 */
export function PublishPanel({ projectId, shownVersion, latestVersion, className }: PublishPanelProps) {
  const [retry, setRetry] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // When the key changes (a retry, another project) the old result no longer
  // matches and the state is loaded again.
  const key = `${projectId}:${retry}`

  useEffect(() => {
    let cancelled = false
    fetchPublishState(projectId).then(
      (state) => {
        if (!cancelled) setLoaded({ key, state })
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoaded({
            key,
            error: describeApiError(error, "We couldn't check whether your website is online."),
          })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [projectId, key])

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const current = loaded?.key === key ? loaded : null
  const state = current && "state" in current ? current.state : null
  const live = state !== null && state.publishedVersion !== null
  const shownIsLive = live && state.publishedVersion === shownVersion
  const liveIsBehind = live && (state.publishedVersion ?? 0) < latestVersion
  const publishedWhen = formatTime(state?.publishedAt ?? null)

  async function run(kind: Exclude<Busy, null>, action: () => Promise<void>, failure: string) {
    if (busy) return
    setBusy(kind)
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(describeApiError(error, failure))
    } finally {
      setBusy(null)
    }
  }

  function publish() {
    return run(
      "publish",
      async () => {
        const next = await publishWebsite(projectId, shownVersion)
        setLoaded({ key, state: next })
      },
      "We couldn't publish your website. Please try again."
    )
  }

  function unpublish() {
    setConfirmingUnpublish(false)
    return run(
      "unpublish",
      async () => {
        await unpublishWebsite(projectId)
        setLoaded({ key, state: { publishedVersion: null, siteUrl: null, publishedAt: null } })
      },
      "We couldn't take your website offline. Please try again."
    )
  }

  function download() {
    return run(
      "download",
      () => downloadWebsite(projectId, shownVersion),
      "We couldn't download your website. Please try again."
    )
  }

  async function copyLink() {
    if (!state?.siteUrl) return
    try {
      await navigator.clipboard.writeText(state.siteUrl)
      setCopied(true)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setActionError("Your browser blocked copying. Select the link and copy it by hand.")
    }
  }

  return (
    <section aria-label="Publish your website" className={cn("cv-surface p-5 sm:p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-medium text-cream">
            <Rocket className="size-4 text-gold" aria-hidden />
            Publish your website
          </h2>

          <div role="status" aria-live="polite" className="mt-2 text-sm leading-6 text-cream/75">
            {current === null ? (
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                Checking whether your website is online...
              </span>
            ) : null}

            {state && !live ? (
              <span>
                Not online yet. Publishing puts version {shownVersion} at a public link you can
                share, or you can download the file and host it yourself.
              </span>
            ) : null}

            {state && live ? (
              <span>
                <span className="mr-2 inline-flex items-center gap-1.5 rounded bg-gold px-1.5 py-0.5 align-middle text-[0.65rem] font-medium tracking-wide text-forest uppercase">
                  <span aria-hidden className="size-1.5 rounded-full bg-forest" />
                  Live
                </span>
                Version {state.publishedVersion} is online
                {publishedWhen ? ` (published ${publishedWhen})` : ""}.
                {liveIsBehind
                  ? ` You have newer changes (version ${latestVersion}) that are not online yet.`
                  : ""}
              </span>
            ) : null}
          </div>

          {state?.siteUrl ? (
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
              <a
                href={state.siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cv-link min-w-0 truncate rounded-md border border-cream/15 bg-cream/[0.05] px-3 py-2 text-sm underline-offset-4 hover:underline"
                title={state.siteUrl}
              >
                {state.siteUrl}
              </a>
              <button type="button" onClick={copyLink} className={CHIP}>
                {copied ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
                {copied ? "Copied" : "Copy link"}
              </button>
              <a href={state.siteUrl} target="_blank" rel="noopener noreferrer" className={CHIP}>
                <ExternalLink className="size-4" aria-hidden />
                Open site
              </a>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={publish}
            disabled={busy !== null || current === null || !state || shownIsLive}
            className="cv-btn cv-btn-primary"
          >
            {busy === "publish" ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <Rocket aria-hidden />
            )}
            {busy === "publish"
              ? "Publishing..."
              : shownIsLive
                ? "Up to date"
                : live
                  ? `Publish version ${shownVersion}`
                  : "Publish website"}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={busy !== null}
            className="cv-btn cv-btn-secondary"
          >
            {busy === "download" ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            Download HTML
          </button>
        </div>
      </div>

      {live && !confirmingUnpublish ? (
        <button
          type="button"
          onClick={() => setConfirmingUnpublish(true)}
          disabled={busy !== null}
          className="mt-4 text-xs text-cream/65 underline underline-offset-4 outline-none hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50"
        >
          Take website offline
        </button>
      ) : null}

      {live && confirmingUnpublish ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-cream/85">
          <span>The public link will stop working. Your saved versions are kept.</span>
          <button type="button" onClick={unpublish} disabled={busy !== null} className={CHIP}>
            {busy === "unpublish" ? "Taking offline..." : "Yes, take it offline"}
          </button>
          <button type="button" onClick={() => setConfirmingUnpublish(false)} className={CHIP}>
            Cancel
          </button>
        </div>
      ) : null}

      {current && "error" in current ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-(--cv-error)">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          <span>{current.error}</span>
          <button type="button" onClick={() => setRetry((value) => value + 1)} className={CHIP}>
            Try again
          </button>
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-(--cv-error)">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {actionError}
        </p>
      ) : null}
    </section>
  )
}
