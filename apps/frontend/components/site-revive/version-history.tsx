"use client"

import { useEffect, useId, useState } from "react"
import { CircleAlert, History, LoaderCircle } from "lucide-react"

import {
  describeApiError,
  fetchVersion,
  fetchVersionHistory,
  type SavedProject,
  type VersionSummary,
} from "@/lib/site-revive-api"
import { cn } from "@/lib/utils"
import type { WebsiteCapture } from "@/types/backend"

type VersionHistoryProps = {
  projectId: string
  /** The newest saved version this page knows of. A change reloads the list while it is open. */
  latestVersion: number
  /** The older version being previewed, or null when the latest is shown. */
  viewingVersion: number | null
  /** Used to rebuild an old version's design (hero photo, gallery, social links). */
  capture?: WebsiteCapture
  /** Called with an older version's design when the user chooses "View". */
  onView: (version: SavedProject) => void
  /** Called when the user goes back to the latest version. */
  onBackToLatest: () => void
  className?: string
}

type Loaded =
  | { key: string; versions: VersionSummary[] }
  | { key: string; error: string }

const CHIP =
  "rounded-md border border-cream/20 px-3 py-1.5 text-xs text-cream/75 transition-colors outline-none hover:border-cream/45 hover:bg-cream/[0.08] hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50"

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

/**
 * The saved versions of a redesign, newest first: the original redesign and
 * every prompt edit. Read-only: choosing "View" previews an older version, it
 * does not change or delete anything. Data is loaded only while the panel is
 * open.
 */
export function VersionHistory({
  projectId,
  latestVersion,
  viewingVersion,
  capture,
  onView,
  onBackToLatest,
  className,
}: VersionHistoryProps) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [retry, setRetry] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [opening, setOpening] = useState<number | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  // One key per thing worth loading. When it changes (a new edit, a retry) the
  // old result no longer matches and the list loads again.
  const key = `${projectId}:${latestVersion}:${retry}`

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchVersionHistory(projectId).then(
      (versions) => {
        if (!cancelled) setLoaded({ key, versions })
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoaded({
            key,
            error: describeApiError(error, "We couldn't load the version history. Please try again."),
          })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [open, projectId, key])

  const current = loaded?.key === key ? loaded : null
  const isLoading = open && current === null

  async function view(versionNumber: number) {
    if (opening !== null) return
    setOpenError(null)
    if (versionNumber === latestVersion) {
      onBackToLatest()
      return
    }
    setOpening(versionNumber)
    try {
      onView(await fetchVersion(projectId, versionNumber, capture))
    } catch (error) {
      setOpenError(
        describeApiError(error, "We couldn't load that version. Please try again.")
      )
    } finally {
      setOpening(null)
    }
  }

  return (
    <section aria-label="Version history" className={cn("cv-surface p-5 sm:p-6", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-cream outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
      >
        <History className="size-4 text-gold" aria-hidden />
        Version history
        <span className="ml-auto text-xs font-normal text-cream/65">
          {open ? "Hide" : `${latestVersion} saved ${latestVersion === 1 ? "version" : "versions"}`}
        </span>
      </button>

      {open ? (
        <div id={panelId} className="mt-4">
          {isLoading ? (
            <p role="status" className="flex items-center gap-2 text-sm text-cream/70">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              Loading versions...
            </p>
          ) : null}

          {current && "error" in current ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-(--cv-error)">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              <span>{current.error}</span>
              <button type="button" onClick={() => setRetry((value) => value + 1)} className={CHIP}>
                Try again
              </button>
            </div>
          ) : null}

          {current && "versions" in current ? (
            <ol className="flex flex-col gap-2">
              {current.versions.map((version) => {
                const isLatest = version.versionNumber === latestVersion
                const isViewing = viewingVersion === version.versionNumber
                const shownNow = isViewing || (isLatest && viewingVersion === null)
                const when = formatTime(version.createdAt)
                return (
                  <li
                    key={version.versionNumber}
                    aria-current={shownNow ? "true" : undefined}
                    className={cn(
                      "flex flex-col gap-2 rounded-md border px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4",
                      shownNow ? "border-gold/60 bg-cream/[0.06]" : "border-cream/15"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm text-cream">
                        Version {version.versionNumber}
                        <span className="text-cream/65">
                          {version.changeType === "INITIAL" ? "Original redesign" : "Edit"}
                        </span>
                        {isLatest ? (
                          <span className="rounded bg-gold px-1.5 py-0.5 text-[0.65rem] font-medium tracking-wide text-forest uppercase">
                            Latest
                          </span>
                        ) : null}
                      </p>
                      {version.prompt ? (
                        <p className="mt-0.5 truncate text-xs text-cream/65" title={version.prompt}>
                          &ldquo;{version.prompt}&rdquo;
                        </p>
                      ) : null}
                      {when ? <p className="mt-0.5 text-xs text-cream/50">{when}</p> : null}
                    </div>
                    <button
                      type="button"
                      disabled={opening !== null || shownNow}
                      onClick={() => view(version.versionNumber)}
                      aria-label={
                        shownNow
                          ? `Version ${version.versionNumber} is shown`
                          : `View version ${version.versionNumber}`
                      }
                      className={CHIP}
                    >
                      {opening === version.versionNumber ? "Loading..." : shownNow ? "Shown" : "View"}
                    </button>
                  </li>
                )
              })}
            </ol>
          ) : null}

          {openError ? (
            <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-(--cv-error)">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {openError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
