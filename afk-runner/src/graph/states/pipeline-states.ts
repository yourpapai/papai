// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { kernelSetup } from '../../kernel/machine.js'

export const start = kernelSetup.createStateConfig({
  on: {
    'stage.enter': {
      target: 'intake',
      guard: { type: 'isStage', params: { stage: 'intake' } },
      actions: ['closeThenActivate'],
    },
  },
})

export const intake = kernelSetup.createStateConfig({
  on: {
    'stage.enter': {
      target: 'draft',
      guard: { type: 'isStage', params: { stage: 'draft' } },
      actions: ['closeThenActivate'],
    },
  },
})

export const draft = kernelSetup.createStateConfig({
  on: {
    'stage.enter': {
      target: 'review',
      guard: { type: 'isStage', params: { stage: 'review' } },
      actions: ['closeThenActivate'],
    },
  },
})

export const review = kernelSetup.createStateConfig({
  on: {
    'stage.enter': [
      {
        target: 'review',
        guard: { type: 'isStage', params: { stage: 'review' } },
        actions: ['closeThenActivate'],
      },
      {
        target: 'decompose',
        guard: { type: 'isStage', params: { stage: 'decompose' } },
        actions: ['closeThenActivate'],
      },
    ],
    // The early (cap-hit) gate parks positionally: interstitial after review
    // exit, the presented event itself moves into the gate compound. Gate
    // events never touch the stage map — no closeThenActivate here (D1).
    'gate.presented': { target: 'gate', actions: ['presentGate'] },
  },
})

export const decompose = kernelSetup.createStateConfig({
  on: {
    'stage.enter': {
      target: 'atomicity',
      guard: { type: 'isStage', params: { stage: 'atomicity' } },
      actions: ['closeThenActivate'],
    },
  },
})

export const atomicity = kernelSetup.createStateConfig({
  on: {
    'stage.enter': {
      target: 'gate',
      guard: { type: 'isStage', params: { stage: 'gate' } },
      actions: ['closeThenActivate'],
    },
  },
})

/**
 * GATE compound (C4 D1): `awaiting` is the machine-state park of a presented
 * gate. Entries: interstitial `gate.presented` from review (early) or the
 * compound's own initial child via `stage.enter(gate)` (final, C5's bracket).
 * Exits key on the legacy mover events — `round.open` (extend) back to
 * review, `stage.enter(decompose)` (approve-early), `stage.enter(draft)`
 * (veto) — plus `gate.answered` + all-done → completed (existing edge) and
 * `gate.answered` outcome=abort → aborted (new logs only). Per-state edges
 * re-declare the root assigns they shadow (`openRound`, `closeThenActivate`,
 * `presentGate`, `answerGate`); re-presentation re-enters awaiting (fresh
 * version = genuinely fresh awaiting, D1).
 */
export const gate = kernelSetup.createStateConfig({
  initial: 'awaiting',
  on: {
    'gate.answered': { target: 'completed', guard: 'allStagesDone', actions: ['answerGate'] },
  },
  states: {
    awaiting: kernelSetup.createStateConfig({
      on: {
        'gate.presented': { target: 'awaiting', reenter: true, actions: ['presentGate'] },
        'gate.answered': { target: '#pipeline.aborted', guard: 'isAbortOutcome', actions: ['answerGate'] },
        'round.open': { target: '#pipeline.review', actions: ['openRound'] },
        'stage.enter': [
          {
            target: '#pipeline.decompose',
            guard: { type: 'isStage', params: { stage: 'decompose' } },
            actions: ['closeThenActivate'],
          },
          {
            target: '#pipeline.draft',
            guard: { type: 'isStage', params: { stage: 'draft' } },
            actions: ['closeThenActivate'],
          },
        ],
      },
    }),
  },
})

export const completed = kernelSetup.createStateConfig({ type: 'final' })

export const aborted = kernelSetup.createStateConfig({ type: 'final' })
