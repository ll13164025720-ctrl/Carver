import { isMockMode, redesignWebsite } from "@/lib/site-revive-api"
import type { RedesignResult } from "@/types/website"

/**
 * Runs a redesign through the SiteRevive API client and tracks it for the UI.
 *
 * The stages below are driven by a timer in both modes. They do not reflect
 * real work. In mock mode the result is held back so every stage is visible.
 * In API mode the result is shown as soon as the backend answers. Real
 * per-stage progress needs a status contract from the backend (see the
 * asynchronous jobs section in lib/site-revive-api.ts).
 */

export const REDESIGN_STAGES = [
  "Analyzing your website",
  "Extracting business content",
  "Creating a modern design",
  "Preparing preview",
] as const

export const STAGE_DURATION_MS = 1600

export interface RedesignJob {
  /** Epoch ms when the job started, used to work out the simulated stage. */
  startedAt: number
  promise: Promise<RedesignResult>
}

/** One running job per URL, so repeated triggers never start a second request. */
const inFlight = new Map<string, RedesignJob>()

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Index of the simulated stage after `elapsedMs`. Stays on the last stage until the job ends. */
export function stageIndexAt(elapsedMs: number): number {
  const index = Math.floor(elapsedMs / STAGE_DURATION_MS)
  return Math.min(Math.max(index, 0), REDESIGN_STAGES.length - 1)
}

async function run(
  url: string,
  options: { simulateFailure?: boolean }
): Promise<RedesignResult> {
  // Real backend: no artificial delay and no simulated failure.
  if (!isMockMode()) return redesignWebsite(url)

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
  options: { simulateFailure?: boolean } = {}
): RedesignJob {
  const existing = inFlight.get(url)
  if (existing) return existing

  const job: RedesignJob = { startedAt: Date.now(), promise: run(url, options) }
  inFlight.set(url, job)

  const release = () => {
    if (inFlight.get(url) === job) inFlight.delete(url)
  }
  job.promise.then(release, release)

  return job
}
