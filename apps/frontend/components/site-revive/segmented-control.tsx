"use client"

import type { LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  icon?: LucideIcon
}

type SegmentedControlProps<T extends string> = {
  /** Accessible name for the group, e.g. "Preview mode". */
  label: string
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

/** Single-choice toggle group built from the shared Button. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex rounded-xl border border-white/15 bg-white/5 p-1",
        className
      )}
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon }) => {
        const selected = optionValue === value
        return (
          <Button
            key={optionValue}
            type="button"
            variant="ghost"
            aria-pressed={selected}
            onClick={() => onChange(optionValue)}
            className={cn(
              "h-9 rounded-lg px-3 text-sm",
              selected
                ? "bg-white text-black hover:bg-white/90 hover:text-black dark:hover:bg-white/90"
                : "text-white/70 hover:bg-white/10 hover:text-white dark:hover:bg-white/10"
            )}
          >
            {Icon ? <Icon aria-hidden data-icon="inline-start" /> : null}
            {optionLabel}
          </Button>
        )
      })}
    </div>
  )
}
