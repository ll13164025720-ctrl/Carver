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
    <ol className={cn("flex flex-col gap-1", className)}>
      {stages.map((label, index) => {
        const state = stateFor(index, activeIndex, status)
        return (
          <li
            key={label}
            aria-current={state === "active" ? "step" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-3 transition-colors",
              state === "active" && "bg-white/5",
              state === "failed" && "bg-red-500/10"
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center">
              {state === "done" ? (
                <CircleCheck className="size-5 text-violet-400" aria-hidden />
              ) : null}
              {state === "active" ? (
                <LoaderCircle
                  className="size-5 text-violet-400 motion-safe:animate-spin"
                  aria-hidden
                />
              ) : null}
              {state === "failed" ? (
                <CircleAlert className="size-5 text-red-400" aria-hidden />
              ) : null}
              {state === "pending" ? (
                <Circle className="size-5 text-white/25" aria-hidden />
              ) : null}
            </span>
            <span
              className={cn(
                "text-base",
                state === "active" && "font-medium text-white",
                state === "done" && "text-white/80",
                state === "failed" && "font-medium text-red-300",
                state === "pending" && "text-white/40"
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
