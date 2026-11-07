"use client"

import Link from "next/link"
import { ArrowLeft, Columns2, FlaskConical, Monitor, Smartphone, Sparkles, Clock } from "lucide-react"

import type { Device } from "@/components/site-revive/device-frame"
import {
  SegmentedControl,
  type SegmentedOption,
} from "@/components/site-revive/segmented-control"

export type ViewMode = "before" | "after" | "compare"

const VIEW_OPTIONS: readonly SegmentedOption<ViewMode>[] = [
  { value: "before", label: "Before", icon: Clock },
  { value: "after", label: "After", icon: Sparkles },
  { value: "compare", label: "Compare", icon: Columns2 },
]

const DEVICE_OPTIONS: readonly SegmentedOption<Device>[] = [
  { value: "desktop", label: "Desktop", icon: Monitor },
  { value: "mobile", label: "Mobile", icon: Smartphone },
]

type PreviewToolbarProps = {
  hostname: string
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
  device: Device
  onDeviceChange: (device: Device) => void
}

export function PreviewToolbar({
  hostname,
  mode,
  onModeChange,
  device,
  onDeviceChange,
}: PreviewToolbarProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-md text-sm font-medium text-white/70 transition-colors outline-none hover:text-white focus-visible:ring-3 focus-visible:ring-white/50"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to home
        </Link>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Your redesign preview
          </h1>
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-white/70">
            <FlaskConical className="size-3.5" aria-hidden />
            Demo mode
          </p>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">
          This is a sample design, not generated from {hostname}. The
          &ldquo;before&rdquo; image is a placeholder, because demo mode
          doesn&apos;t capture your real website.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <SegmentedControl
          label="Preview mode"
          options={VIEW_OPTIONS}
          value={mode}
          onChange={onModeChange}
        />
        <SegmentedControl
          label="Device size"
          options={DEVICE_OPTIONS}
          value={device}
          onChange={onDeviceChange}
        />
      </div>
    </div>
  )
}
