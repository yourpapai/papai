// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { clipTail } from '../../opencode-agent/src/check-loop.js'
import type { RunJob } from '../../opencode-agent/src/github-actions.js'
import { selectFailedJobs } from '../../opencode-agent/src/red-run.js'

const job = (overrides: Partial<RunJob> = {}): RunJob => ({
  id: 1,
  name: 'Build',
  conclusion: 'failure',
  steps: [
    { name: 'Set up job', conclusion: 'success' },
    { name: 'Run the checks', conclusion: 'failure' },
  ],
  ...overrides,
})

describe('selectFailedJobs', () => {
  test('keeps only the jobs that failed', async () => {
    const jobs = [
      job({ id: 1, name: 'Lint', conclusion: 'success' }),
      job({ id: 2, name: 'Build', conclusion: 'failure' }),
      job({ id: 3, name: 'Cancelled leg', conclusion: 'cancelled' }),
      job({ id: 4, name: 'Still running', conclusion: null }),
    ]

    const failed = await selectFailedJobs(jobs, () => Promise.resolve('log'))

    // Only `failure` is a defect a fix round can address: a cancelled job has
    // no verdict to fix and a running one has no result yet, so treating either
    // as failed would send the diagnosis after a failure that does not exist.
    expect(failed.map((entry) => entry.name)).toEqual(['Build'])
  })

  test('names only the steps that failed within a job', async () => {
    const failed = await selectFailedJobs([job()], () => Promise.resolve('log'))

    expect(failed[0]?.failedSteps).toEqual(['Run the checks'])
  })

  test('keeps a failed job whose every step passed — a job-level failure', async () => {
    // A runner that died between steps, a startup error: the job is red, no
    // step is. The diagnosis needs the log exactly then, and dropping the job
    // for having no failed step would report the run green.
    const failed = await selectFailedJobs([job({ steps: [{ name: 'Set up job', conclusion: 'success' }] })], () =>
      Promise.resolve('The runner received a shutdown signal'),
    )

    expect(failed).toHaveLength(1)
    expect(failed[0]?.failedSteps).toEqual([])
  })

  test('clips each job’s log to the tail under a per-job budget', async () => {
    const longLog = `${'a'.repeat(6000)}\n${'the error'.padStart(10, ' ')}`
    const failed = await selectFailedJobs([job({ id: 9 })], (id) => Promise.resolve(`id ${id}: ${longLog}`), {
      logBudget: 1000,
    })

    // Failures cluster at a log's end, so the tail is the excerpt worth
    // keeping — same doctrine as `clipTail`, same "says how much it dropped".
    expect(failed[0]?.log).toContain('truncated')
    expect(failed[0]?.log.endsWith(' the error')).toBeTrue()
    expect(failed[0]?.log.length).toBeLessThan(1200)
  })

  test('fetches each failed job’s log by its id, in job order', async () => {
    const fetched: number[] = []
    const failed = await selectFailedJobs([job({ id: 11, name: 'First' }), job({ id: 22, name: 'Second' })], (id) => {
      fetched.push(id)
      return Promise.resolve(`log of ${id}`)
    })

    expect(fetched).toEqual([11, 22])
    expect(failed.map((entry) => entry.log)).toEqual(['log of 11', 'log of 22'])
  })

  test('a job whose log cannot be fetched still reaches the diagnosis', async () => {
    // Expired log (410) and gone job answer the same as a missing one. The
    // job's name and failed steps are facts the jobs listing already proved;
    // a diagnosis that dropped the whole job over its log would go quiet about
    // the one failure that made the run red.
    const failed = await selectFailedJobs([job({ id: 5, name: 'Build' })], () =>
      Promise.reject(new Error('log expired')),
    )

    expect(failed[0]?.name).toBe('Build')
    expect(failed[0]?.log).toBe('')
  })

  test('an aggregate of many jobs cannot blow the prompt: the budget is per job', async () => {
    const jobs = [job({ id: 1 }), job({ id: 2 }), job({ id: 3 })]
    const bigLog = 'x'.repeat(9000)

    const failed = await selectFailedJobs(jobs, () => Promise.resolve(bigLog), { logBudget: 1000 })

    for (const entry of failed) expect(entry.log.length).toBeLessThan(1100)
  })
})

describe('clipTail reuse', () => {
  test('stays the one clipper: a red-run excerpt is the same shape as a check output', () => {
    expect(clipTail('abcdef', 3)).toBe('…(truncated 3 chars)…\ndef')
  })
})
