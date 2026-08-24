// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { clipTail } from './check-loop.js'
import type { RefCheckRun, RunJob } from './github-actions.js'
import { mapSeries } from './sequence.js'

/**
 * What a red workflow run says about itself, distilled for a diagnosis.
 *
 * The CI-fix phase's facts: which jobs failed, which steps inside them, and a
 * clipped excerpt of each failed job's log. Pure selection over the shapes
 * `github-actions.ts` returns — the fetching of logs is handed in, so this
 * module stays testable without a transport and stays out of the
 * best-effort-versus-fatal decision, which belongs to the phase.
 */

/** One failed job, as the diagnosis prompt and the report read it. */
export interface FailedJob {
  id: number
  name: string
  /** Names of the job's steps whose conclusion was `failure`; may be empty. */
  failedSteps: readonly string[]
  /** The job's log, clipped to its tail; empty when it could not be fetched. */
  log: string
}

export interface SelectFailedJobsOptions {
  /** Characters kept from each failed job's log. */
  logBudget?: number
}

const DEFAULT_LOG_BUDGET = 8000

/**
 * `failure`, or nothing. The only conclusion a fix round can address: a
 * cancelled job has no verdict to fix, a running one no result yet, and
 * treating either as failed sends the diagnosis after a failure that does not
 * exist.
 */
const isFailure = (job: RunJob): boolean => job.conclusion === 'failure'

const toFailedJob = async (
  job: RunJob,
  jobLog: (id: number) => Promise<string>,
  budget: number,
): Promise<FailedJob> => {
  // A degraded log degrades the excerpt, not the job: the name and the failed
  // steps are facts the jobs listing already proved, and dropping the whole
  // entry over its log would go quiet about the one failure that made the run
  // red. An expired log (410) is the common shape of this.
  let log = ''
  try {
    log = clipTail(await jobLog(job.id), budget)
  } catch {
    log = ''
  }

  return {
    id: job.id,
    name: job.name,
    // A job whose every step passed stays listed — a runner that died between
    // steps is a job-level failure, with no step to name and a log that
    // matters more, not less.
    failedSteps: job.steps.filter((step) => step.conclusion === 'failure').map((step) => step.name),
    log,
  }
}

/**
 * The failed jobs of a run, with their failed steps and clipped logs, in job
 * order. Per-job budget, never per-run: failures cluster at a log's end, and
 * the aggregate cap that actually bounds the prompt is `prompt-budget.ts`'s,
 * applied where every other content path gets it.
 */
export const selectFailedJobs = (
  jobs: readonly RunJob[],
  jobLog: (id: number) => Promise<string>,
  options: SelectFailedJobsOptions = {},
): Promise<readonly FailedJob[]> => {
  const budget = options.logBudget ?? DEFAULT_LOG_BUDGET
  return mapSeries(jobs.filter(isFailure), (job) => toFailedJob(job, jobLog, budget))
}

/**
 * `failure` or `timed_out` — the terminal conclusions that mean the check ran
 * and ended red with a verdict to fix.
 *
 * Pinned here rather than inherited from {@link isFailure}, whose rationale
 * argues about cancelled and *running* jobs: a timed-out check run is a runner
 * that hit its deadline, red on the pull request and addressable, and reading
 * it as green would spend the round's `ciAttempts` answering "nothing found"
 * on a red head. `cancelled`, `skipped`, `stale`, `neutral`, `action_required`
 * and `success` stay out for the reason `isFailure`'s own rationale gives: a
 * check that did not finish has no verdict to fix, and treating one as failed
 * sends the diagnosis after a failure that does not exist.
 */
const isFailedCheck = (run: RefCheckRun): boolean => run.conclusion === 'failure' || run.conclusion === 'timed_out'

/**
 * The failed check runs of a ref, mapped into the `FailedJob` shape the
 * diagnosis and the report already read.
 *
 * A command-bought round's facts: no run arrived with the command, so the
 * output summary stands in for the job log — tail-clipped by the same budget
 * — and there are no step conclusions to name, which the report already
 * renders as "no step failed". Everything downstream is untouched.
 */
export const failedJobsFromCheckRuns = (runs: readonly RefCheckRun[]): readonly FailedJob[] =>
  runs.filter(isFailedCheck).map((run) => ({
    id: run.id,
    name: run.name,
    failedSteps: [],
    log: clipTail(run.summary, DEFAULT_LOG_BUDGET),
  }))
