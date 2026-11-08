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
        "inline-flex rounded-lg border border-cream/20 bg-cream/[0.05] p-1",
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
              "h-9 rounded-md px-3.5 text-sm font-medium focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
              selected
                ? "bg-cream text-forest hover:bg-cream hover:text-forest dark:hover:bg-cream"
                : "text-cream/75 hover:bg-cream/10 hover:text-cream dark:hover:bg-cream/10"
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
