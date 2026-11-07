"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export type Device = "desktop" | "mobile"

/**
 * Logical screen size of each device. Content is laid out at exactly this size
 * and then scaled down to fit the available space, so "Mobile" really shows
 * the 390px layout even on a wide monitor.
 */
export const DEVICE_VIEWPORTS: Record<Device, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 780 },
}

/** Width of the phone bezel on each side, in px. */
const PHONE_BEZEL = 10

type ScaledViewportProps = {
  width: number
  height: number
  children: ReactNode
}

/**
 * Lays children out in a fixed `width` x `height` box and scales that box down
 * to fit the available width (never up). Children should fill the box.
 */
function ScaledViewport({ width, height, children }: ScaledViewportProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState<number | null>(null)

  useEffect(() => {
    const element = outerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setAvailableWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const scale = availableWidth ? Math.min(1, availableWidth / width) : 1

  return (
    <div
      ref={outerRef}
      className="w-full overflow-hidden"
      style={{ height: height * scale }}
    >
      <div
        // Hidden until measured, so the first paint is never at the wrong size.
        className={cn(availableWidth === null && "invisible")}
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  )
}

type DeviceFrameProps = {
  device: Device
  /** Text for the browser address bar (desktop only). */
  address: string
  children: ReactNode
  className?: string
}

/** Browser window (desktop) or phone (mobile) around scaled-to-fit content. */
export function DeviceFrame({ device, address, children, className }: DeviceFrameProps) {
  const { width, height } = DEVICE_VIEWPORTS[device]

  if (device === "mobile") {
    return (
      <div
        className={cn(
          "mx-auto w-full overflow-hidden rounded-[2.5rem] border-neutral-800 bg-black shadow-2xl",
          className
        )}
        style={{
          maxWidth: width + PHONE_BEZEL * 2,
          borderWidth: PHONE_BEZEL,
          borderStyle: "solid",
        }}
      >
        <div aria-hidden className="flex h-5 items-center justify-center bg-black">
          <span className="h-1.5 w-20 rounded-full bg-neutral-800" />
        </div>
        <ScaledViewport width={width} height={height}>
          {children}
        </ScaledViewport>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "mx-auto overflow-hidden rounded-xl border border-white/15 bg-neutral-900 shadow-2xl",
        className
      )}
      // Never wider than the real desktop viewport (plus the 1px borders).
      style={{ maxWidth: width + 2 }}
    >
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <div aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400/80" />
          <span className="size-2.5 rounded-full bg-amber-400/80" />
          <span className="size-2.5 rounded-full bg-green-400/80" />
        </div>
        <p className="mx-auto max-w-sm min-w-0 flex-1 truncate rounded-md bg-white/10 px-3 py-1 text-center text-xs text-white/60">
          {address}
        </p>
        <div aria-hidden className="hidden w-12 sm:block" />
      </div>
      <ScaledViewport width={width} height={height}>
        {children}
      </ScaledViewport>
    </div>
  )
}
