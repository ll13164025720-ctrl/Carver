"use client"

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import { CircleAlert, LoaderCircle } from "lucide-react"

import { DeviceFrame, DEVICE_VIEWPORTS, type Device } from "@/components/site-revive/device-frame"
import { GeneratedPageFrame } from "@/components/site-revive/generated-page-frame"
import { OriginalSiteView } from "@/components/site-revive/original-site-view"
import { PreviewEmptyState } from "@/components/site-revive/preview-empty-state"
import {
  PreviewToolbar,
  type ViewMode,
} from "@/components/site-revive/preview-toolbar"
import {
  PromptEditor,
  type PromptEditFeedback,
} from "@/components/site-revive/prompt-editor"
import { ProcessingFallback } from "@/components/site-revive/processing-fallback"
import { VersionHistory } from "@/components/site-revive/version-history"
import { WebsiteRenderer } from "@/components/site-revive/website-renderer"
import { DEMO_EDIT_COMMANDS } from "@/lib/design-editor"
import {
  parseStoredProject,
  readStoredProjectJson,
  saveProject,
  type StoredProject,
} from "@/lib/redesign-session"
import {
  API_EDIT_EXAMPLES,
  SiteReviveApiError,
  describeApiError,
  editWebsite,
  fetchLatestProject,
  isMockMode,
  type SavedProject,
} from "@/lib/site-revive-api"
import { cn } from "@/lib/utils"
import type { SiteContent } from "@/types/website"

const API_EDIT_PLACEHOLDER =
  "Describe a change, e.g. Make the colors warmer or Add a section about our story"

type StoredProjectState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; project: StoredProject }

// Session storage cannot change while this page is open, so nothing to watch.
const subscribeToNothing = () => () => {}
// undefined = still on the server / hydrating, which is different from "nothing stored".
const readOnServer = (): string | null | undefined => undefined

/** Reads the project saved by the processing screen, without a hydration mismatch. */
function useStoredProject(): StoredProjectState {
  const raw = useSyncExternalStore<string | null | undefined>(
    subscribeToNothing,
    readStoredProjectJson,
    readOnServer
  )

  return useMemo<StoredProjectState>(() => {
    if (raw === undefined) return { status: "loading" }
    const project = parseStoredProject(raw)
    return project ? { status: "ready", project } : { status: "empty" }
  }, [raw])
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

type PreviewPaneProps = {
  label: string
  caption: string
  tone: "before" | "after"
  children: ReactNode
}

function PreviewPane({ label, caption, tone, children }: PreviewPaneProps) {
  return (
    <section aria-label={label} className="min-w-0">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium tracking-[0.12em] uppercase",
            tone === "after"
              ? "bg-gold text-forest"
              : "border border-cream/30 text-cream"
          )}
        >
          {label}
        </span>
        <span className="truncate text-sm text-cream/65">{caption}</span>
      </div>
      {children}
    </section>
  )
}

type ConflictNoticeProps = {
  /** The newest saved version, if the backend said which. */
  latestVersion?: number
  /** Loads it. Resolves with an error message, or null on success. */
  onLoad: () => Promise<string | null>
}

/**
 * Shown when an edit was refused because the project has a newer saved version
 * (for example it was edited in another window). Nothing is replaced until the
 * user chooses to load the newer version.
 */
function ConflictNotice({ latestVersion, onLoad }: ConflictNoticeProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (loading) return
    setLoading(true)
    setError(null)
    setError(await onLoad())
    setLoading(false)
  }

  return (
    <div
      role="alert"
      className="cv-surface mt-8 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
    >
      <div className="flex items-start gap-3 text-sm text-cream">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
        <div>
          <p>
            This website was changed somewhere else
            {latestVersion ? ` (it is now at version ${latestVersion})` : ""}, so your edit was not
            applied. What you see here is not the newest version.
          </p>
          {error ? <p className="mt-1 text-(--cv-error)">{error}</p> : null}
        </div>
      </div>
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="cv-btn cv-btn-primary shrink-0"
      >
        {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
        Load latest version
      </button>
    </div>
  )
}

export function PreviewWorkspace() {
  const state = useStoredProject()
  const [mode, setMode] = useState<ViewMode>("compare")
  const [device, setDevice] = useState<Device>("desktop")
  // The content after prompt edits, and the saved version it corresponds to.
  // null until the first successful edit, so the stored project is used as-is.
  // With the real backend each edit is also written back to this tab's stored
  // project (see adopt), so a refresh keeps it. Sample-mode edits stay in memory
  // only (reset on refresh).
  const [edited, setEdited] = useState<{
    content: SiteContent
    versionNumber?: number
  } | null>(null)
  // An older saved version being previewed (read-only). null shows the latest.
  const [viewing, setViewing] = useState<SavedProject | null>(null)
  // Set when an edit was refused because a newer version exists.
  const [conflict, setConflict] = useState<{ latestVersion?: number } | null>(null)

  if (state.status === "loading") return <ProcessingFallback />
  if (state.status === "empty") return <PreviewEmptyState />

  const { sourceUrl, result } = state.project
  // Every edit starts from what is shown now, not from the first generation...
  const content = edited?.content ?? result.content
  // ...on top of the latest saved version, so the backend can refuse it if the
  // project has moved on (an edit made in another window).
  const versionNumber = edited?.versionNumber ?? result.versionNumber
  const shown = viewing?.content ?? content
  const hostname = hostnameOf(sourceUrl)

  /** Makes a saved state the one shown and stored, so edits and refreshes continue from it. */
  function adopt(next: { content: SiteContent; versionNumber?: number }) {
    setEdited(next)
    setViewing(null)
    setConflict(null)
    if (!isMockMode()) {
      // Best effort: if storage refuses, the state above still drives the page.
      saveProject(sourceUrl, {
        ...result,
        content: next.content,
        ...(next.versionNumber ? { versionNumber: next.versionNumber } : {}),
      })
    }
  }

  async function applyPrompt(instruction: string): Promise<PromptEditFeedback> {
    try {
      const edit = await editWebsite({
        projectId: result.projectId,
        prompt: instruction,
        content,
        versionNumber,
        capture: result.capture,
      })
      // Shown only once the returned result has actually been applied.
      adopt({
        content: edit.content,
        // Keep the old number if the backend did not save a version.
        versionNumber: edit.versionNumber ?? versionNumber,
      })
      // With the real backend an edit that changes nothing visible is reported
      // as a problem so the text stays in the box to be rephrased. In sample
      // mode "already that value" is a normal answer.
      return { ok: edit.changed || isMockMode(), message: edit.summary }
    } catch (error) {
      // Nothing was applied: what is shown stays exactly as it was.
      if (error instanceof SiteReviveApiError && error.code === "conflict") {
        setConflict({ latestVersion: error.latestVersion })
      }
      return {
        ok: false,
        message: describeApiError(
          error,
          "Something went wrong while applying that change. Please try again."
        ),
      }
    }
  }

  /** Replaces what is shown with the newest saved version, at the user's request. */
  async function loadLatest(): Promise<string | null> {
    try {
      adopt(await fetchLatestProject(result.projectId, result.capture))
      return null
    } catch (error) {
      return describeApiError(error, "We couldn't load the latest version. Please try again.")
    }
  }

  const showBefore = mode === "before" || mode === "compare"
  const showAfter = mode === "after" || mode === "compare"

  return (
    <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-16 sm:px-6">
      <PreviewToolbar
        hostname={hostname}
        mode={mode}
        onModeChange={setMode}
        device={device}
        onDeviceChange={setDevice}
      />

      {showAfter && conflict ? (
        <ConflictNotice latestVersion={conflict.latestVersion} onLoad={loadLatest} />
      ) : null}

      {showAfter && viewing ? (
        <div
          role="status"
          className="cv-surface mt-8 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
        >
          <p className="text-sm text-cream">
            You are viewing version {viewing.versionNumber}, an older version. Editing is turned off
            until you go back to the latest version.
          </p>
          <button
            type="button"
            onClick={() => setViewing(null)}
            className="cv-btn cv-btn-primary shrink-0"
          >
            Back to latest
          </button>
        </div>
      ) : null}

      {showAfter && !viewing ? (
        <PromptEditor
          onApply={applyPrompt}
          examples={isMockMode() ? DEMO_EDIT_COMMANDS : API_EDIT_EXAMPLES}
          placeholder={isMockMode() ? undefined : API_EDIT_PLACEHOLDER}
          className={cn("cv-surface p-5 sm:p-6", conflict ? "mt-4" : "mt-8")}
        />
      ) : null}

      {showAfter && !isMockMode() && versionNumber ? (
        <VersionHistory
          projectId={result.projectId}
          latestVersion={versionNumber}
          viewingVersion={viewing?.versionNumber ?? null}
          capture={result.capture}
          onView={setViewing}
          onBackToLatest={() => setViewing(null)}
          className="mt-4"
        />
      ) : null}

      <div
        className={cn(
          "mt-10 grid items-start gap-12",
          mode === "compare" && "lg:grid-cols-2"
        )}
      >
        {showBefore ? (
          <PreviewPane
            label="Before"
            caption={`Original website (${hostname})${isMockMode() ? ", sample placeholder" : ""}`}
            tone="before"
          >
            <DeviceFrame device={device} address={sourceUrl}>
              <div className="h-full">
                <OriginalSiteView screenshotUrl={result.originalScreenshotUrl} />
              </div>
            </DeviceFrame>
          </PreviewPane>
        ) : null}

        {showAfter ? (
          <PreviewPane
            label="After"
            caption={
              viewing
                ? `Version ${viewing.versionNumber} (not the latest), ${DEVICE_VIEWPORTS[device].width}px wide`
                : `Redesign preview, ${DEVICE_VIEWPORTS[device].width}px wide`
            }
            tone="after"
          >
            <DeviceFrame device={device} address={`${hostname} (redesign preview)`}>
              {shown.kind === "page" ? (
                <GeneratedPageFrame
                  page={shown.page}
                  baseUrl={result.capture?.finalUrl || sourceUrl}
                  title={`${hostname} redesign preview`}
                />
              ) : (
                <WebsiteRenderer design={shown.design} className="h-full" />
              )}
            </DeviceFrame>
          </PreviewPane>
        ) : null}
      </div>
    </main>
  )
}
