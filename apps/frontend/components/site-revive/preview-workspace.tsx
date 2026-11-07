"use client"

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react"

import { DeviceFrame, DEVICE_VIEWPORTS, type Device } from "@/components/site-revive/device-frame"
import { OriginalSiteView } from "@/components/site-revive/original-site-view"
import { PreviewEmptyState } from "@/components/site-revive/preview-empty-state"
import {
  PreviewToolbar,
  type ViewMode,
} from "@/components/site-revive/preview-toolbar"
import { ProcessingFallback } from "@/components/site-revive/processing-fallback"
import { WebsiteRenderer } from "@/components/site-revive/website-renderer"
import {
  parseStoredProject,
  readStoredProjectJson,
  type StoredProject,
} from "@/lib/redesign-session"
import { cn } from "@/lib/utils"

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

  if (state.status === "loading") return <ProcessingFallback />
  if (state.status === "empty") return <PreviewEmptyState />

  const { sourceUrl, result } = state.project
  const hostname = hostnameOf(sourceUrl)
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

      <div
        className={cn(
          "mt-8 grid items-start gap-10",
          mode === "compare" && "lg:grid-cols-2"
        )}
      >
        {showBefore ? (
          <PreviewPane
            label="Before"
            caption={`Original website (${hostname}), sample placeholder`}
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
              <WebsiteRenderer design={result.design} className="h-full" />
            </DeviceFrame>
          </PreviewPane>
        ) : null}
      </div>
    </main>
  )
}
