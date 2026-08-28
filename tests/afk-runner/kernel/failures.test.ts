// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { EventInputSchema, SddEventSchema, stampEvent } from '../../../afk-runner/src/events.js'
import type { EventInput } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { toKernelEvent } from '../../../afk-runner/src/kernel/fold.js'
import { initialStep, step } from '../../../afk-runner/src/kernel/machine.js'
import type { KernelSnapshot } from '../../../afk-runner/src/kernel/machine.js'
import { createReplayFolder } from '../../../afk-runner/src/legacy-fold.js'

const failedInput: EventInput = {
  altitude: 'L2',
  type: 'stage_failed',
  stage: 'draft',
  kind: 'exhausted',
  reason: 'draft specs failed after 2 attempts: invalid',
}

function walk(events: readonly Parameters<typeof step>[2][]): KernelSnapshot {
  let snapshot = initialStep(pipelineMachine)[0]
  for (const event of events) snapshot = step(pipelineMachine, snapshot, event)[0]
  return snapshot
}

describe('stage_failed event schema (C6 D2)', () => {
  it('parses the full shape with kind, reason, and optional resume hint', () => {
    expect(EventInputSchema.safeParse(failedInput).success).toBe(true)
    expect(EventInputSchema.safeParse({ ...failedInput, resumeHint: 'resume the run' }).success).toBe(true)
    const stamped = stampEvent({ ...failedInput, resumeHint: 'resume the run' }, 1, '2026-08-29T00:00:00.000Z')
    expect(SddEventSchema.safeParse(stamped).success).toBe(true)
  })

  it('rejects an unknown kind, a missing reason, and an unknown stage', () => {
    expect(EventInputSchema.safeParse({ ...failedInput, kind: 'bug' }).success).toBe(false)
    expect(EventInputSchema.safeParse({ ...failedInput, reason: '' }).success).toBe(false)
    expect(EventInputSchema.safeParse({ ...failedInput, stage: 'tail' }).success).toBe(false)
  })
})

describe('toKernelEvent mapping', () => {
  it('maps stage_failed to the kernel stage.failed event carrying stage and kind', () => {
    const event = stampEvent({ ...failedInput, resumeHint: 'resume the run' }, 1, '2026-08-29T00:00:00.000Z')
    expect(toKernelEvent(event)).toEqual({ type: 'stage.failed', stage: 'draft', kind: 'exhausted' })
  })
})

describe('kernel fold — per-stage failures ledger as non-projected residue (C6 D2)', () => {
  const toDraft = [
    { type: 'stage.enter', stage: 'intake' },
    { type: 'stage.enter', stage: 'draft' },
  ] as const

  it('increments a per-stage counter without touching the stage map', () => {
    const snapshot = walk([...toDraft, { type: 'stage.failed', stage: 'draft', kind: 'exhausted' }])
    expect(snapshot.context.failures).toEqual({ draft: 1 })
    expect(snapshot.context.stages['draft']).toBe('active')
    expect(snapshot.value).toBe('draft')
  })

  it('counts consecutive failures per stage independently', () => {
    const snapshot = walk([
      ...toDraft,
      { type: 'stage.failed', stage: 'draft', kind: 'exhausted' },
      { type: 'stage.failed', stage: 'draft', kind: 'infra' },
    ])
    expect(snapshot.context.failures).toEqual({ draft: 2 })
  })

  it('a stage successful exit clears its ledger entry — a later failure starts fresh', () => {
    const cleared = walk([
      ...toDraft,
      { type: 'stage.failed', stage: 'draft', kind: 'exhausted' },
      { type: 'stage.exit', stage: 'draft' },
    ])
    expect(cleared.context.failures).toEqual({})
    const refailed = step(pipelineMachine, cleared, { type: 'stage.failed', stage: 'draft', kind: 'exhausted' })[0]
    expect(refailed.context.failures).toEqual({ draft: 1 })
  })

  it('records from any position — a failure at gate.awaiting is root bookkeeping', () => {
    const snapshot = walk([
      ...toDraft,
      { type: 'stage.enter', stage: 'review' },
      { type: 'gate.presented', mode: 'early', version: 1 },
      { type: 'stage.failed', stage: 'review', kind: 'precondition' },
    ])
    expect(snapshot.value).toEqual({ gate: 'awaiting' })
    expect(snapshot.context.failures).toEqual({ review: 1 })
  })
})

describe('legacy fold tolerates the type (parity both directions)', () => {
  it('a stage_failed event leaves the legacy ReplayState unchanged', () => {
    const folder = createReplayFolder()
    const before = { ...folder.state, stages: { ...folder.state.stages } }
    const folded = folder.fold(failedInput)
    expect(folded).toEqual(before)
  })
})
