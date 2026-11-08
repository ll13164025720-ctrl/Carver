import {
  isMockMode,
  redesignWebsite,
  type RedesignStage,
} from "@/lib/site-revive-api"
import type { RedesignResult } from "@/types/website"

/**
 * Runs a redesign through the SiteRevive API client and tracks it for the UI.
 *
 * Mock mode: the stages are driven by a timer and do not reflect real work. The
 * result is held back so every stage is visible.
 *
 * API mode: the backend has no progress feed, but the client makes two
 * requests, so the job knows which one is running. While the website is being
 * captured the timer advances through the first two stages and stops there.
 * Once the AI request starts the job moves to the "Creating a modern design"
 * stage and stays until the result arrives. The result is shown as soon as the
 * backend answers.
 */

export const REDESIGN_STAGES = [
  "Analyzing your website",
  "Extracting business content",
  "Creating a modern design",
  "Preparing preview",
] as const

export const STAGE_DURATION_MS = 1600

/** Last stage the timer may show while the website is still being captured. */
const LAST_CAPTURE_STAGE = 1
/** Stage shown while the AI creates the design. */
const DESIGN_STAGE = 2

export interface RedesignJob {
  /** Epoch ms when the job started. */
  startedAt: number
  promise: Promise<RedesignResult>
  /** Index into REDESIGN_STAGES to show right now. */
  stageIndex: () => number
}

/**
 * One running job per URL and design direction, so repeated triggers (React's
 * double-run effects, repeat clicks) never start a second request. A different
 * instruction for the same URL is a different job.
 */
const inFlight = new Map<string, RedesignJob>()

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Index of the simulated stage after `elapsedMs`. Stays on the last stage until the job ends. */
export function stageIndexAt(elapsedMs: number): number {
  const index = Math.floor(elapsedMs / STAGE_DURATION_MS)
  return Math.min(Math.max(index, 0), REDESIGN_STAGES.length - 1)
}

export interface RedesignJobOptions {
  simulateFailure?: boolean
  /** The owner's design direction. Only the real backend uses it. */
  instruction?: string
}

async function run(
  url: string,
  options: RedesignJobOptions,
  onStage: (stage: RedesignStage) => void
): Promise<RedesignResult> {
  // Real backend: no artificial delay and no simulated failure.
  if (!isMockMode()) return redesignWebsite(url, { onStage, instruction: options.instruction })

  if (options.simulateFailure) {
    // Fail part-way through so the failed stage is visible.
    await sleep(STAGE_DURATION_MS * 2 + 400)
    throw new Error(
      "Simulated failure (mock mode). Nothing is wrong with your website."
    )
  }

  const [result] = await Promise.all([
    redesignWebsite(url),
    sleep(REDESIGN_STAGES.length * STAGE_DURATION_MS),
  ])
  return result
}

/**
 * Starts a redesign for `url`, or returns the job already running for it.
 * Callers must attach their own `.then`/`.catch` to `job.promise`.
 */
export function startRedesignJob(
  url: string,
  options: RedesignJobOptions = {}
): RedesignJob {
  const key = `${url}\u0000${options.instruction ?? ""}`
  const existing = inFlight.get(key)
  if (existing) return existing

  const startedAt = Date.now()
  let stage: RedesignStage | null = null

  const job: RedesignJob = {
    startedAt,
    promise: run(url, options, (next) => {
      stage = next
    }),
    stageIndex: () => {
      const byTime = stageIndexAt(Date.now() - startedAt)
      if (stage === "capturing") return Math.min(byTime, LAST_CAPTURE_STAGE)
      if (stage === "designing") return DESIGN_STAGE
      return byTime
    },
  }
  inFlight.set(key, job)

  const release = () => {
    if (inFlight.get(key) === job) inFlight.delete(key)
  }
  job.promise.then(release, release)

  return job
}
