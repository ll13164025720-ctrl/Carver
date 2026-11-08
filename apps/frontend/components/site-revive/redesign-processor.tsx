"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, FlaskConical, Globe, RotateCcw } from "lucide-react"

import {
  ProcessingStages,
  type ProcessingStatus,
} from "@/components/site-revive/processing-stages"
import { Button, buttonVariants } from "@/components/ui/button"
import { REDESIGN_STAGES, startRedesignJob } from "@/lib/redesign-job"
import { clearProject, saveProject } from "@/lib/redesign-session"
import { isMockMode } from "@/lib/site-revive-api"
import { cn } from "@/lib/utils"
import { validateWebsiteUrl } from "@/lib/validate-url"

const PREVIEW_PATH = "/preview"
/** Short pause on the completed state so the user sees every stage finish. */
const REDIRECT_DELAY_MS = 700
const LAST_STAGE = REDESIGN_STAGES.length - 1

type Phase =
  | { status: "running" }
  | { status: "done" }
  | { status: "error"; message: string; failedStage: number }

/**
 * Reads the submitted URL from `?url=` and re-validates it, because query
 * strings can be edited by anyone. Invalid or missing input never starts a job.
 */
export function RedesignProcessor() {
  const searchParams = useSearchParams()
  const validation = validateWebsiteUrl(searchParams.get("url") ?? "")

  // Developer test hook for the failure and retry path. The first attempt
  // fails and the retry succeeds. It is ignored in production builds.
  const simulateFailure =
    process.env.NODE_ENV !== "production" &&
    searchParams.get("simulate") === "failure"

  if (!validation.ok) {
    return (
      <Shell>
        <h1 className="text-3xl font-semibold tracking-tight">
          We couldn&apos;t read that website address
        </h1>
        <p role="alert" className="mt-4 text-white/70">
          {validation.error}
        </p>
        <BackToStart className="mt-8" label="Enter a website URL" />
      </Shell>
    )
  }

  return (
    <ProcessingView
      // A different URL gets a fresh view and fresh state.
      key={validation.url}
      url={validation.url}
      hostname={validation.hostname}
      simulateFailure={simulateFailure}
    />
  )
}

type ProcessingViewProps = {
  url: string
  hostname: string
  simulateFailure: boolean
}

function ProcessingView({ url, hostname, simulateFailure }: ProcessingViewProps) {
  const router = useRouter()
  const mockMode = isMockMode()
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>({ status: "running" })
  const [stageIndex, setStageIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    let redirectTimer: ReturnType<typeof setTimeout> | undefined

    // Never leave a previous run's result behind: if this attempt fails, the
    // preview must not show a project for a different URL.
    clearProject()

    // Returns the job already running for this URL if there is one, so React's
    // double-invoked effects and repeat clicks never send a second request.
    const job = startRedesignJob(url, {
      simulateFailure: simulateFailure && attempt === 0,
    })

    const ticker = setInterval(() => {
      setStageIndex(job.stageIndex())
    }, 250)

    job.promise.then(
      (result) => {
        if (cancelled) return
        clearInterval(ticker)

        if (!saveProject(url, result)) {
          setPhase({
            status: "error",
            failedStage: LAST_STAGE,
            message:
              "Your browser blocked temporary storage, so we couldn't hand the result to the preview. Check your privacy settings and try again.",
          })
          return
        }

        setStageIndex(LAST_STAGE)
        setPhase({ status: "done" })
        // replace(), not push(), so Back returns to the landing page and not
        // to a processing screen that would start over.
        redirectTimer = setTimeout(
          () => router.replace(PREVIEW_PATH),
          REDIRECT_DELAY_MS
        )
      },
      (error: unknown) => {
        if (cancelled) return
        clearInterval(ticker)
        setPhase({
          status: "error",
          failedStage: job.stageIndex(),
          message:
            error instanceof Error && error.message
              ? error.message
              : "Something went wrong while creating your preview.",
        })
      }
    )

    return () => {
      cancelled = true
      clearInterval(ticker)
      clearTimeout(redirectTimer)
    }
  }, [url, attempt, simulateFailure, router])

  function handleRetry() {
    if (phase.status !== "error") return
    setStageIndex(0)
    setPhase({ status: "running" })
    setAttempt((current) => current + 1)
  }

  const status: ProcessingStatus = phase.status
  const activeIndex = phase.status === "error" ? phase.failedStage : stageIndex

  const heading =
    status === "done"
      ? "Your preview is ready"
      : status === "error"
        ? "We couldn't finish your preview"
        : "Reviving your website"

  const announcement =
    status === "done"
      ? "Preview ready. Opening it now."
      : status === "error"
        ? "Something went wrong."
        : `${REDESIGN_STAGES[activeIndex]}. Step ${activeIndex + 1} of ${REDESIGN_STAGES.length}.`

  return (
    <Shell>
      {mockMode ? (
        <p className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-white/70">
          <FlaskConical className="size-3.5" aria-hidden />
          Demo mode
        </p>
      ) : null}

      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {heading}
      </h1>

      <div className="mt-6 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
        <Globe className="size-5 shrink-0 text-white/60" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs text-white/50">Website</p>
          <p className="truncate font-medium" title={url}>
            {url}
          </p>
        </div>
      </div>

      <ProcessingStages
        className="mt-6"
        stages={REDESIGN_STAGES}
        activeIndex={activeIndex}
        status={status}
      />

      <p className="mt-6 text-sm leading-6 text-white/50">
        {mockMode ? (
          <>
            These steps are simulated. In demo mode we don&apos;t contact{" "}
            {hostname} or analyze it, and the preview will show a sample café
            design instead of your own content.
          </>
        ) : (
          <>
            This can take a minute or two while we visit {hostname} and design
            your preview. The steps above are an estimate of progress. Please
            keep this tab open.
          </>
        )}
      </p>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {phase.status === "error" ? (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-red-400/30 bg-red-500/10 p-4"
        >
          <p className="text-sm leading-6 text-red-200">{phase.message}</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              size="lg"
              onClick={handleRetry}
              className="h-11 rounded-xl bg-violet-600 px-5 text-base font-semibold text-white shadow-lg shadow-violet-600/30 hover:bg-violet-500 focus-visible:border-violet-300 focus-visible:ring-violet-400/50"
            >
              <RotateCcw aria-hidden data-icon="inline-start" />
              Try again
            </Button>
            <BackToStart label="Use a different URL" />
          </div>
        </div>
      ) : null}

      {phase.status === "running" ? (
        <BackToStart
          className="mt-6 border-transparent px-0 text-white/60 hover:bg-transparent hover:text-white"
          label="Cancel"
          showArrow={false}
        />
      ) : null}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-12 sm:py-16">
      {children}
    </main>
  )
}

function BackToStart({
  label,
  className,
  showArrow = true,
}: {
  label: string
  className?: string
  showArrow?: boolean
}) {
  return (
    <Link
      href="/"
      className={cn(
        buttonVariants({ variant: "outline", size: "lg" }),
        "h-11 w-fit rounded-xl border-white/20 bg-transparent px-5 text-base text-white hover:bg-white/10 hover:text-white",
        className
      )}
    >
      {label}
      {showArrow ? <ArrowRight aria-hidden data-icon="inline-end" /> : null}
    </Link>
  )
}
