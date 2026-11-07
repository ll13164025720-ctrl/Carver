import { Circle, CircleAlert, CircleCheck, LoaderCircle } from "lucide-react"

import { cn } from "@/lib/utils"

export type ProcessingStatus = "running" | "done" | "error"

type ProcessingStagesProps = {
  stages: readonly string[]
  /** Index of the stage that is running, or that failed when status is "error". */
  activeIndex: number
  status: ProcessingStatus
  className?: string
}

type StageState = "done" | "active" | "failed" | "pending"

function stateFor(
  index: number,
  activeIndex: number,
  status: ProcessingStatus
): StageState {
  if (status === "done") return "done"
  if (index < activeIndex) return "done"
  if (index === activeIndex) return status === "error" ? "failed" : "active"
  return "pending"
}

const STATE_LABEL: Record<StageState, string> = {
  done: "Completed",
  active: "In progress",
  failed: "Failed",
  pending: "Waiting",
}

export function ProcessingStages({
  stages,
  activeIndex,
  status,
  className,
}: ProcessingStagesProps) {
  return (
    <ol className={cn("flex flex-col gap-1.5", className)}>
      {stages.map((label, index) => {
        const state = stateFor(index, activeIndex, status)
        return (
          <li
            key={label}
            aria-current={state === "active" ? "step" : undefined}
            className={cn(
              "flex items-center gap-4 rounded-lg border border-transparent px-4 py-3.5 transition-colors",
              state === "active" && "border-cream/15 bg-cream/[0.06]",
              state === "failed" && "border-(--cv-error)/40 bg-(--cv-error)/10"
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center">
              {state === "done" ? (
                <CircleCheck className="size-5 text-gold" aria-hidden />
              ) : null}
              {state === "active" ? (
                <LoaderCircle
                  className="size-5 text-cream motion-safe:animate-spin"
                  aria-hidden
                />
              ) : null}
              {state === "failed" ? (
                <CircleAlert className="size-5 text-(--cv-error)" aria-hidden />
              ) : null}
              {state === "pending" ? (
                <Circle className="size-5 text-cream/30" aria-hidden />
              ) : null}
            </span>
            <span
              className={cn(
                "text-base",
                state === "active" && "font-medium text-cream",
                state === "done" && "text-cream/80",
                state === "failed" && "font-medium text-(--cv-error)",
                state === "pending" && "text-cream/60"
              )}
            >
              {label}
              <span className="sr-only">: {STATE_LABEL[state]}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
