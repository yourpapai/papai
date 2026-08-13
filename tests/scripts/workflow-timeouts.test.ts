// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

/**
 * Every job declares a wall-clock ceiling, and every ceiling fits inside GitHub's.
 *
 * A job with no `timeout-minutes` is not unbounded — it inherits 360 minutes, the
 * hosted-runner cap — which is the problem: the inherited value is six hours of
 * held concurrency slot for work measured in minutes, and nothing in the run says
 * so until the six hours are up. Five of nine CI jobs were in that state, the
 * longest of them a mutation gate observed at 39 minutes, so "someone will notice"
 * had already been tried.
 *
 * This is a test rather than an actionlint rule because actionlint checks that a
 * workflow is *valid*, and a job with no timeout is perfectly valid. It is the
 * same reason `bun workflows:lint` exists at all: the failure mode is a green
 * board, so the gate has to be something that goes red on its own.
 *
 * The upper bound is the other half. `timeout-minutes` may only ever *lower* the
 * hosted cap: a larger value is silently ignored and the job is killed at 360
 * anyway, so a job declaring 600 is not asking for ten hours, it is documenting a
 * ceiling it will never reach. That is worth failing on — it is a statement about
 * the run that is not true.
 */

const WORKFLOW_DIR = path.join(import.meta.dir, '..', '..', '.github', 'workflows')

/** GitHub's hard cap for a job on a hosted runner, in minutes. */
const HOSTED_JOB_CAP_MINUTES = 360

const jobSchema = z.object({
  // A string as often as a number: the agent job's ceiling is an expression
  // (`${{ vars.X || 300 }}`), which YAML hands back as text. Both spellings are a
  // declared ceiling, which is what this file is about.
  'timeout-minutes': z.union([z.number(), z.string()]).optional(),
  uses: z.string().optional(),
})

const workflowSchema = z.object({ jobs: z.record(z.string(), jobSchema) })

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
  .sort()

/** Every `<file>` / `<job id>` pair in the directory, as the test's cases. */
const jobs = workflows.flatMap((file) => {
  const parsed = workflowSchema.parse(Bun.YAML.parse(readFileSync(path.join(WORKFLOW_DIR, file), 'utf8')))
  return Object.entries(parsed.jobs).map(([id, job]) => ({ file, id, job }))
})

/**
 * The literal minutes a ceiling declares, or `null` when it is an expression.
 *
 * An expression cannot be range-checked here — its value lives in a repository
 * variable this process cannot read — so the numeric assertion skips it. The
 * agent job's fallback is checked instead where it is written, in
 * `tests/opencode-agent/workflow.test.ts`, which is also the file that knows why
 * that particular number has to leave room for the pipeline's own stop.
 */
const literalMinutes = (declared: number | string | undefined): number | null => {
  if (typeof declared === 'number') return declared
  if (declared === undefined) return null
  return /^\d+$/u.test(declared.trim()) ? Number(declared.trim()) : null
}

/**
 * The subset with a literal ceiling, pre-filtered so the range assertion has no
 * branch in it.
 *
 * Deciding *inside* a test which jobs it applies to would make a job that stopped
 * declaring a number pass by skipping, which is the failure the filter is here to
 * avoid: a job absent from this list is still covered, by the every-job assertion
 * above it.
 */
const literalCeilings = jobs
  .map(({ file, id, job }) => ({ label: `${file} · ${id}`, minutes: literalMinutes(job['timeout-minutes']) }))
  .filter((entry): entry is { label: string; minutes: number } => entry.minutes !== null)

describe('workflow job timeouts', () => {
  test('the directory was actually read', () => {
    // Without this, a rename of `.github/workflows` turns every assertion below
    // into a vacuous pass over an empty list — the failure mode a test.each over a
    // globbed directory always has.
    expect(workflows.length).toBeGreaterThan(5)
    expect(jobs.length).toBeGreaterThan(10)
  })

  test.each(jobs.map(({ file, id, job }) => [`${file} · ${id}`, job] as const))(
    '%s declares a timeout-minutes',
    (_label, job) => {
      expect(job['timeout-minutes']).toBeDefined()
    },
  )

  test('every literal ceiling was actually collected', () => {
    // The expression-valued one is the agent job's; everything else is a number,
    // so a filter that quietly emptied itself would be visible here rather than as
    // a row of passing no-ops below.
    expect(literalCeilings.length).toBe(jobs.length - 1)
  })

  test.each(literalCeilings.map((entry) => [entry.label, entry.minutes] as const))(
    '%s declares a timeout GitHub will honour',
    (_label, minutes) => {
      expect(minutes).toBeGreaterThan(0)
      expect(minutes).toBeLessThanOrEqual(HOSTED_JOB_CAP_MINUTES)
    },
  )
})
