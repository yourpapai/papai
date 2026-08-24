// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Octokit } from '@octokit/rest'
import { z } from 'zod'

/**
 * The Actions half of the GitHub surface: what a red workflow run can say
 * about itself.
 *
 * Cut on the same seam as `github-labels.ts` and `github-pulls.ts` — one
 * endpoint family with a vocabulary of its own — when the CI-fix phase
 * stopped reproducing CI against a configured check list and started reading
 * the run it was asked to repair. The jobs of a run name what failed; the log
 * of a job says why. Nothing here is best-effort: whether a rejected call is
 * fatal depends on which phase asked, and a CI-fix round that cannot read the
 * run reports needs-human rather than crashing, which is a decision for the
 * phase.
 */

export interface RunJobStep {
  name: string
  conclusion: string | null
}

export interface RunJob {
  id: number
  name: string
  conclusion: string | null
  steps: readonly RunJobStep[]
}

/**
 * One check run of a ref, as a command-bought CI-fix round reads it.
 *
 * The `id` is carried even though this round downloads no log of its own: the
 * `FailedJob` it becomes keys on one, and the day summaries prove too thin as
 * evidence the member grows a log fetch against it without any other shape
 * changing (the design's recorded trade-off).
 */
export interface RefCheckRun {
  id: number
  name: string
  conclusion: string | null
  /** The check run's `output.summary`, redacted at this boundary like every free-text read. */
  summary: string
}

export interface ActionsApi {
  /**
   * The jobs of one workflow run, with each job's steps and their
   * conclusions. Paginated to the same page size as every other list here so
   * a matrix build cannot hide its failing leg.
   */
  listRunJobs(runId: number): Promise<readonly RunJob[]>
  /**
   * One job's log, as text. Redacted at this boundary like every free-text
   * read: a CI log quotes back whatever a build printed, and GitHub masks
   * repository secrets in it but masks nothing a step chose to echo.
   */
  jobLog(jobId: number): Promise<string>
  /**
   * The check runs of a ref (branch or sha), with name, conclusion and output
   * summary — what a command-bought CI-fix round reads, because no run id
   * arrived with the command. The Checks API, its own `GITHUB_TOKEN`
   * permission class: `actions: read` does not cover it.
   */
  listCheckRunsForRef(ref: string): Promise<readonly RefCheckRun[]>
}

/** One job row, as far as the pipeline reads it: zod at the boundary, per doctrine. */
const runJobRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  conclusion: z.string().nullable().catch(null),
  steps: z
    .array(
      z.object({
        name: z.string(),
        conclusion: z.string().nullable().catch(null),
      }),
    )
    .default([]),
})

/**
 * Narrows one raw job row to the shape the pipeline reads.
 *
 * The endpoint's generated types are wide enough (every field optional, steps
 * nullable) that trusting them would push `unknown`-shaped holes into every
 * consumer. Unparseable rows are skipped rather than defaulted: a job GitHub
 * cannot name is not one a diagnosis can use, and a narrowing that invented an
 * id would point a log download at some other job. An absent `conclusion`
 * stays `null` — `success` is the one conclusion the caller filters on, so a
 * default of that string would make an unfinished job look finished.
 */
const toRunJob = (raw: unknown): RunJob | null => {
  const parsed = runJobRowSchema.safeParse(raw)
  if (!parsed.success) return null
  const { id, name, conclusion, steps } = parsed.data
  return {
    id,
    name,
    conclusion,
    steps: steps.map((step) => ({ name: step.name, conclusion: step.conclusion })),
  }
}

/** One check-run row, as far as a command-bought round reads it. */
const refCheckRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  conclusion: z.string().nullable().catch(null),
  output: z
    .object({
      summary: z.string().nullable().catch(null),
    })
    .nullable()
    .catch(null),
})

/**
 * Narrows one raw check-run row, redacting its free text at the boundary.
 *
 * The same skip-don't-default doctrine as {@link toRunJob}: a check run GitHub
 * cannot name is not one a diagnosis can quote, and a narrowed `conclusion`
 * stays `null` when the API left it null — an in-progress check is not a
 * finished one.
 */
const toRefCheckRun = (raw: unknown, clean: (text: string) => string): RefCheckRun | null => {
  const parsed = refCheckRowSchema.safeParse(raw)
  if (!parsed.success) return null
  const { id, name, conclusion, output } = parsed.data
  return { id, name, conclusion, summary: clean(output?.summary ?? '') }
}

export const createActionsEndpoints = (
  octokit: Octokit,
  repo: { owner: string; repo: string },
  clean: (text: string) => string,
): ActionsApi => ({
  listRunJobs: async (runId) => {
    const rows: readonly unknown[] = await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, {
      ...repo,
      run_id: runId,
      per_page: 100,
    })

    // Skipped rather than defaulted: a job GitHub cannot name is not one a
    // diagnosis can use, and a narrowing that invented an id would point a log
    // download at some other job.
    const jobs: RunJob[] = []
    for (const row of rows) {
      const job = toRunJob(row)
      if (job !== null) jobs.push(job)
    }
    return jobs
  },

  jobLog: async (jobId) => {
    const { data } = await octokit.rest.actions.downloadJobLogsForWorkflowRun({ ...repo, job_id: jobId })
    return clean(typeof data === 'string' ? data : '')
  },

  listCheckRunsForRef: async (ref) => {
    const rows: readonly unknown[] = await octokit.paginate(octokit.rest.checks.listForRef, {
      ...repo,
      ref,
      per_page: 100,
    })

    const runs: RefCheckRun[] = []
    for (const row of rows) {
      const run = toRefCheckRun(row, clean)
      if (run !== null) runs.push(run)
    }
    return runs
  },
})
