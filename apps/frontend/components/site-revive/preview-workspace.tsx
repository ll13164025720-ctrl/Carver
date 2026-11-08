"use client"

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react"

import { DeviceFrame, DEVICE_VIEWPORTS, type Device } from "@/components/site-revive/device-frame"
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
import type { WebsiteBlueprint } from "@/types/backend"
import type { WebsiteDesign } from "@/types/website"

const API_EDIT_PLACEHOLDER =
  "Describe a change, e.g. Change the hero headline to Welcome to Our Cafe"

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

export function PreviewWorkspace() {
  const state = useStoredProject()
  const [mode, setMode] = useState<ViewMode>("compare")
  const [device, setDevice] = useState<Device>("desktop")
  // Design (and, with the real backend, its blueprint) after prompt edits. null
  // until the first successful edit, so the stored project is used as-is. With
  // the real backend each edit is also written back to the stored project, so a
  // refresh keeps it. Sample-mode edits stay in memory only (reset on refresh).
  const [edited, setEdited] = useState<{
    design: WebsiteDesign
    blueprint?: WebsiteBlueprint
    versionNumber?: number
  } | null>(null)
  // An older saved version being previewed (read-only). null shows the latest.
  const [viewing, setViewing] = useState<SavedProject | null>(null)

  if (state.status === "loading") return <ProcessingFallback />
  if (state.status === "empty") return <PreviewEmptyState />

  const { sourceUrl, result } = state.project
  const design = edited?.design ?? result.design
  // Every edit starts from the latest blueprint, not the one first generated.
  const blueprint = edited?.blueprint ?? result.blueprint
  // ...and on top of the latest saved version, so the backend can refuse it if
  // the project has moved on (an edit made in another window).
  const versionNumber = edited?.versionNumber ?? result.versionNumber
  const hostname = hostnameOf(sourceUrl)

  /** Makes a saved state the one shown and stored, so edits and refreshes continue from it. */
  function adopt(next: { design: WebsiteDesign; blueprint?: WebsiteBlueprint; versionNumber?: number }) {
    setEdited(next)
    setViewing(null)
    if (next.blueprint) {
      // Best effort: if storage refuses, the state above still drives the page.
      saveProject(sourceUrl, {
        ...result,
        design: next.design,
        blueprint: next.blueprint,
        ...(next.versionNumber ? { versionNumber: next.versionNumber } : {}),
      })
    }
  }

  async function applyPrompt(instruction: string): Promise<PromptEditFeedback> {
    try {
      const edit = await editWebsite({
        projectId: result.projectId,
        prompt: instruction,
        currentDesign: design,
        blueprint,
        versionNumber,
        capture: result.capture,
      })
      adopt({
        design: edit.design,
        blueprint: edit.blueprint,
        // Keep the old number if the backend did not save a version.
        versionNumber: edit.versionNumber ?? versionNumber,
      })
      // With the real backend an edit that changes nothing visible is reported
      // as a problem so the text stays in the box to be rephrased. In sample
      // mode "already that value" is a normal answer.
      return { ok: edit.changed || isMockMode(), message: edit.summary }
    } catch (error) {
      // Another window edited this project first. Catch up with its latest
      // version (a refresh would not help: this page's copy is the old one), then
      // ask the user to repeat the change.
      if (error instanceof SiteReviveApiError && error.code === "conflict") {
        try {
          adopt(await fetchLatestProject(result.projectId, result.capture))
        } catch (syncError) {
          return {
            ok: false,
            message: describeApiError(
              syncError,
              "This design changed in another window. Reload the page to continue."
            ),
          }
        }
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
          className="cv-surface mt-8 p-5 sm:p-6"
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
              <WebsiteRenderer design={viewing?.design ?? design} className="h-full" />
            </DeviceFrame>
          </PreviewPane>
        ) : null}
      </div>
    </main>
  )
}
