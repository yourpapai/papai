// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import path from 'node:path'

import type { SddEvent } from '../../../afk-runner/src/events.js'
import { readEvents, stampEvent } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import type { KernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { initialKernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { reviewOutcomeOf } from '../../../afk-runner/src/work/review.js'

const MARATHON_LOG = path.join(
  import.meta.dir,
  '..',
  'fixtures',
  'real',
  '2026-08-19T12-04-49-341Z-7d97443e',
  'events.ndjson',
)

const stamp = (input: Parameters<typeof stampEvent>[0], seq: number): SddEvent =>
  stampEvent(input, seq, '2026-08-27T00:00:00.000Z')

function contextOf(events: readonly SddEvent[]): KernelContext {
  return foldEvents(pipelineMachine, events).snapshot.context
}

describe('review outcome — pure reader of folded context', () => {
  it('an unanswered presented gate parks cap-hit', () => {
    const context = contextOf([
      stamp({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 }, 1),
    ])
    expect(reviewOutcomeOf(context)).toBe('cap-hit')
  })

  it('a converged last verdict (or a passed review stage) is converged', () => {
    const converged = contextOf([
      stamp(
        {
          altitude: 'L2',
          type: 'convergence',
          round: 2,
          verdict: 'converged',
          counts: { blocker: 0, material: 0, nitpick: 1 },
        },
        1,
      ),
    ])
    expect(reviewOutcomeOf(converged)).toBe('converged')
  })

  it('severity convergence: a nitpick-only open cap-hit verdict counts as converged', () => {
    const severity = contextOf([
      stamp(
        {
          altitude: 'L2',
          type: 'convergence',
          round: 1,
          verdict: 'open',
          counts: { blocker: 0, material: 0, nitpick: 2 },
        },
        1,
      ),
    ])
    expect(reviewOutcomeOf(severity)).toBe('converged')
  })

  it('open blockers or materials keep the round incomplete (stopped or crashed)', () => {
    const open = contextOf([
      stamp(
        {
          altitude: 'L2',
          type: 'convergence',
          round: 1,
          verdict: 'open',
          counts: { blocker: 1, material: 0, nitpick: 0 },
        },
        1,
      ),
    ])
    expect(reviewOutcomeOf(open)).toBe('incomplete')
    expect(reviewOutcomeOf(initialKernelContext({}))).toBe('incomplete')
  })
})

describe('review outcome — answered gates release continuation (marathon regression)', () => {
  const events = readEvents(MARATHON_LOG)

  it.each([1188, 1194, 1200])(
    'truncated right after answered seq %s: the extended round is drivable, not cap-hit',
    (seq: number) => {
      const truncated = events.filter((event) => event.seq <= seq)
      const context = foldEvents(pipelineMachine, truncated).snapshot.context
      expect(context.gate).toEqual({ mode: 'early', version: 1, answered: true })
      expect(reviewOutcomeOf(context)).not.toBe('cap-hit')
      expect(reviewOutcomeOf(context)).toBe('incomplete')
    },
  )
})
