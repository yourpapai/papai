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
})
