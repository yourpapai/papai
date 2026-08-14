// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { withDeadline } from '../../opencode-agent/src/deadline.js'
import {
  msToDeadline,
  reviewBudget,
  timeForAnotherPhase,
  timeForAnotherStep,
  turnTimeoutMs,
} from '../../opencode-agent/src/time-budget.js'
import type { TimeBudgetConfig } from '../../opencode-agent/src/time-budget.js'

/**
 * The arithmetic half of the job's wall clock, as values.
 *
 * The stop itself is driven end to end in `orchestrator.test.ts`, against the real
 * cascade and a real state block — a `RunResult` is not the assertion, the comment
 * and the persisted phase are. What is here is what can only be checked as a
 * number: the exact boundary a phase may start on, and the bound one model turn is
 * handed, whose failure mode is silent and off by one function call.
 */

const NOW = Date.UTC(2026, 7, 8, 12, 0)
const MINUTE = 60_000

const budget = (overrides: Partial<TimeBudgetConfig> = {}): TimeBudgetConfig => ({
  agentTimeoutMs: 30 * MINUTE,
  reviewTimeoutMs: 6 * 60 * MINUTE,
  jobDeadlineMs: NOW + 90 * MINUTE,
  teardownReserveMs: 3 * MINUTE,
  wrapUpMs: 2 * MINUTE,
  ...overrides,
})

describe('msToDeadline', () => {
  test('measures the wall clock to the job’s own kill time', () => {
    expect(msToDeadline(budget(), NOW)).toBe(90 * MINUTE)
  })

  test('is null when there is no job deadline, rather than a very large number', () => {
    // `null` rather than `Infinity` so each caller has to decide what "no
    // deadline" means for it — the stop lets the run through, the per-turn bound
    // falls back to its configured cap, and a shared sentinel would have made
    // those one answer by accident.
    expect(msToDeadline(budget({ jobDeadlineMs: null }), NOW)).toBeNull()
  })

  test('goes negative past the deadline, which is a state that really happens', () => {
    // The runner kills the job on its own schedule and nothing here is guaranteed
    // to be asked first, so a run *can* observe a deadline already behind it.
    expect(msToDeadline(budget(), NOW + 91 * MINUTE)).toBe(-MINUTE)
  })
})

describe('timeForAnotherPhase', () => {
  test('is true while there is time left over the reserve', () => {
    expect(timeForAnotherPhase(4 * MINUTE, budget())).toBe(true)
  })

  test('stops at exactly the reserve, not only inside it', () => {
    // The reserve is not time the pipeline may spend and apologise for — it is
    // what pays for the comment, the state block and the label that make a stop
    // something other than a silence. A phase starting on exactly the reserve
    // starts inside the slice that has to report it stopping, so `>=` here would
    // let every job spend the thing that reports it.
    expect(timeForAnotherPhase(3 * MINUTE, budget())).toBe(false)
    expect(timeForAnotherPhase(3 * MINUTE + 1, budget())).toBe(true)
  })

  test('refuses a job already past its deadline', () => {
    expect(timeForAnotherPhase(-MINUTE, budget())).toBe(false)
  })

  test('reads the reserve from the config rather than assuming three minutes', () => {
    expect(timeForAnotherPhase(2 * MINUTE, budget({ teardownReserveMs: MINUTE }))).toBe(true)
  })
})

describe('timeForAnotherStep', () => {
  test('is true while a step could be handed a positive slice of work', () => {
    expect(timeForAnotherStep(10 * MINUTE, budget())).toBe(true)
  })

  test('stops where `turnTimeoutMs` would have to clamp, and not one millisecond later', () => {
    // The two are the same boundary read from opposite ends, which is why this is a
    // predicate rather than a number somebody keeps in step by hand: below
    // reserve + wrap-up, `turnTimeoutMs` clamps to 1ms, so the "step" would consist
    // entirely of being stopped — an abort, a wrap-up window with nothing in front
    // of it, and a salvage of a tree no model had touched.
    expect(timeForAnotherStep(5 * MINUTE, budget())).toBe(false)
    expect(timeForAnotherStep(5 * MINUTE + 1, budget())).toBe(true)
    expect(turnTimeoutMs(budget(), NOW + 85 * MINUTE)).toBe(1)
  })

  test('is stricter than starting a phase, which is the whole point of the gap', () => {
    // A phase may start on anything over the reserve, because refusing one costs
    // the run nothing. Between two steps the tree is committed and pushed, so the
    // pipeline can afford to be fussier: the window where a phase is allowed to
    // begin and a step is not is exactly where a step would be interrupted.
    const left = 4 * MINUTE

    expect(timeForAnotherPhase(left, budget())).toBe(true)
    expect(timeForAnotherStep(left, budget())).toBe(false)
  })

  test('refuses a job already past its deadline', () => {
    expect(timeForAnotherStep(-MINUTE, budget())).toBe(false)
  })
})

describe('turnTimeoutMs', () => {
  test('keeps the configured cap when it fits inside what is left', () => {
    expect(turnTimeoutMs(budget(), NOW)).toBe(30 * MINUTE)
  })

  test('shrinks to what is left of the job, minus the reserve and the wrap-up', () => {
    // D3 of the finding, as one number: the turn cap defaulted to 30 minutes while
    // the job's ceiling was 90, so a turn opened at minute 75 was allowed to wait
    // until minute 105 — past a runner that dies at 90 having posted nothing at
    // all, which is the silence the per-turn deadline exists to prevent.
    //
    // Fifteen minutes left, three held back for the teardown and two for the
    // wrap-up: the work gets ten.
    expect(turnTimeoutMs(budget(), NOW + 75 * MINUTE)).toBe(10 * MINUTE)
  })

  test('leaves the wrap-up window out of the turn’s own bound', () => {
    // The soft stop is a second prompt in the same job, so a turn allowed to run
    // right up to the teardown reserve leaves nothing to ask it in — and the
    // handoff note is the one thing only the model that did the work can write.
    const noWrapUp = turnTimeoutMs(budget({ wrapUpMs: 5_000 }), NOW + 75 * MINUTE)

    expect(noWrapUp - turnTimeoutMs(budget(), NOW + 75 * MINUTE)).toBe(2 * MINUTE - 5_000)
  })

  test('falls back to the configured cap when there is no job deadline', () => {
    // Including the wrap-up: with no job there is no total to slice into three, and
    // `AGENT_TIMEOUT_MS` bounds one turn by definition rather than a whole run — so
    // an `--event-path` run behaves exactly as it did before either slice existed.
    expect(turnTimeoutMs(budget({ jobDeadlineMs: null }), NOW + 75 * MINUTE)).toBe(30 * MINUTE)
  })

  test('never returns a non-positive bound, because that would remove the bound', () => {
    // The trap this function exists for. `withDeadline` treats a non-positive
    // budget as "this caller has nothing to bound" and returns the work unwrapped,
    // so a job already inside its reserve would compute 0 and hand the turn no
    // deadline whatsoever — the exact opposite of shrinking it.
    expect(turnTimeoutMs(budget(), NOW + 90 * MINUTE)).toBe(1)
    expect(turnTimeoutMs(budget(), NOW + 200 * MINUTE)).toBe(1)
  })

  test('the clamped bound really does bound, which zero would not', async () => {
    // Asserted through `withDeadline` itself rather than against the number,
    // because the number is only wrong in terms of what that function does with
    // it: 1ms rejects, 0ms would wait for ever on a turn the runner is about to
    // kill.
    const forever = new Promise<string>(() => {})
    const budgetLeft = turnTimeoutMs(budget(), NOW + 90 * MINUTE)

    await expect(withDeadline(forever, budgetLeft, () => new Error('out of time'))).rejects.toThrow('out of time')
  })
})

describe('reviewBudget', () => {
  test('hands the loop what is left of the job, not one turn’s cap', () => {
    // The defect this replaced: the review loop was bounded by `turnTimeoutMs`,
    // so a phase that legitimately runs for hours was killed at the 90 minutes
    // that bound *one model turn* — with two of the job's five hours unspent.
    const config = budget({ agentTimeoutMs: 90 * MINUTE, jobDeadlineMs: NOW + 300 * MINUTE })

    expect(reviewBudget(config, NOW).hardMs).toBe((300 - 3) * MINUTE)
  })

  test('holds a wrap-up slice back, so the loop stops before it is killed', () => {
    const config = budget({ jobDeadlineMs: NOW + 300 * MINUTE })
    const { hardMs, softMs } = reviewBudget(config, NOW)

    // The soft bound is the one the loop is given; the hard one is the kill that
    // follows if it does not honour it, and the gap is what publishing, writing
    // the summary and printing it costs.
    expect(hardMs - softMs).toBe(2 * MINUTE)
  })

  test('falls back to its own cap when the job has no deadline at all', () => {
    // Every `--event-path` run: there is no job clock to divide up, so the
    // configured review cap stands alone.
    const config = budget({ jobDeadlineMs: null, reviewTimeoutMs: 4 * 60 * MINUTE })

    expect(reviewBudget(config, NOW).hardMs).toBe(4 * 60 * MINUTE)
  })

  test('never exceeds its own cap, however much of the job is left', () => {
    const config = budget({ jobDeadlineMs: NOW + 300 * MINUTE, reviewTimeoutMs: 60 * MINUTE })

    expect(reviewBudget(config, NOW).hardMs).toBe(60 * MINUTE)
  })

  test('clamps to a positive bound inside the reserve, rather than disabling itself', () => {
    // `withDeadline` treats a non-positive budget as "no bound at all", so a job
    // already inside its teardown reserve would hand the loop an *unbounded* run
    // — the exact opposite of what the shrinking is for.
    const { hardMs, softMs } = reviewBudget(budget({ jobDeadlineMs: NOW + MINUTE }), NOW)

    expect(hardMs).toBeGreaterThan(0)
    expect(softMs).toBeGreaterThan(0)
  })
})
