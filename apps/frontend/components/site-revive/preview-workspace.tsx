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
  describeApiError,
  editWebsite,
  isMockMode,
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
            "rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase",
            tone === "after" ? "bg-violet-600 text-white" : "bg-white/15 text-white"
          )}
        >
          {label}
        </span>
        <span className="truncate text-sm text-white/50">{caption}</span>
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
  } | null>(null)

  if (state.status === "loading") return <ProcessingFallback />
  if (state.status === "empty") return <PreviewEmptyState />

  const { sourceUrl, result } = state.project
  const design = edited?.design ?? result.design
  // Every edit starts from the latest blueprint, not the one first generated.
  const blueprint = edited?.blueprint ?? result.blueprint
  const hostname = hostnameOf(sourceUrl)

  async function applyPrompt(instruction: string): Promise<PromptEditFeedback> {
    try {
      const edit = await editWebsite({
        projectId: result.projectId,
        prompt: instruction,
        currentDesign: design,
        blueprint,
        capture: result.capture,
      })
      setEdited({ design: edit.design, blueprint: edit.blueprint })
      if (edit.blueprint) {
        // Best effort: if storage refuses, the edit still shows and later edits
        // still use the blueprint held in state.
        saveProject(sourceUrl, {
          ...result,
          design: edit.design,
          blueprint: edit.blueprint,
        })
      }
      // With the real backend an edit that changes nothing visible is reported
      // as a problem so the text stays in the box to be rephrased. In sample
      // mode "already that value" is a normal answer.
      return { ok: edit.changed || isMockMode(), message: edit.summary }
    } catch (error) {
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

      {showAfter ? (
        <PromptEditor
          onApply={applyPrompt}
          examples={isMockMode() ? DEMO_EDIT_COMMANDS : API_EDIT_EXAMPLES}
          placeholder={isMockMode() ? undefined : API_EDIT_PLACEHOLDER}
          className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5"
        />
      ) : null}

      <div
        className={cn(
          "mt-8 grid items-start gap-10",
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
            caption={`Redesign preview, ${DEVICE_VIEWPORTS[device].width}px wide`}
            tone="after"
          >
            <DeviceFrame device={device} address={`${hostname} (redesign preview)`}>
              <WebsiteRenderer design={design} className="h-full" />
            </DeviceFrame>
          </PreviewPane>
        ) : null}
      </div>
    </main>
  )
}
