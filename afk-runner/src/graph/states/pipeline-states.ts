// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { kernelSetup } from '../../kernel/machine.js'

/**
 * Operator abort mixin (C6 D7): `run_abort` reaches the aborted final from
 * every non-final state. Spread per-state — movement lives in state configs,
 * not a root-level targeted handler (the commonErrorTransitions pattern).
 */
const runAbort = { 'run.abort': { target: '#pipeline.aborted' } } as const

export const start = kernelSetup.createStateConfig({
  on: {
    ...runAbort,
    'stage.enter': {
      target: 'intake',
      guard: { type: 'isStage', params: { stage: 'intake' } },
      actions: ['closeThenActivate'],
    },
  },
})

export const intake = kernelSetup.createStateConfig({
  on: {
    ...runAbort,
    'stage.enter': [
      {
        // Mid-intake crash resume re-enters intake through its own self-loop
        // (C5 D4, the inherited sdd-runner gap healed here only).
        target: 'intake',
        guard: { type: 'isStage', params: { stage: 'intake' } },
        actions: ['closeThenActivate'],
      },
      {
        target: 'draft',
        guard: { type: 'isStage', params: { stage: 'draft' } },
        actions: ['closeThenActivate'],
      },
    ],
    // Escalation presentation (C6 D4): interstitial — the presented event is
    // the mover; the failed stage stays active in the map.
    'gate.presented': { target: 'gate', actions: ['presentGate'] },
  },
})

export const draft = kernelSetup.createStateConfig({
  on: {
    ...runAbort,
    'stage.enter': [
      {
        // The veto mover re-enters draft (C4 D8): the revision round runs as
        // draft re-entry work before flowing back to review.
        target: 'draft',
        guard: { type: 'isStage', params: { stage: 'draft' } },
        actions: ['closeThenActivate'],
      },
      {
        target: 'review',
        guard: { type: 'isStage', params: { stage: 'review' } },
        actions: ['closeThenActivate'],
      },
    ],
    'gate.presented': { target: 'gate', actions: ['presentGate'] },
  },
})

export const review = kernelSetup.createStateConfig({
  on: {
    ...runAbort,
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
    ...runAbort,
    'stage.enter': [
      {
        // Mid-decompose crash resume re-enters through its own self-loop (C5 D4).
        target: 'decompose',
        guard: { type: 'isStage', params: { stage: 'decompose' } },
        actions: ['closeThenActivate'],
      },
      {
        // The depth-S tail skips atomicity entirely (C5 D4): decompose's
        // presentation act enters the gate compound directly.
        target: 'gate',
        guard: { type: 'isStage', params: { stage: 'gate' } },
        actions: ['closeThenActivate'],
      },
      {
        target: 'atomicity',
        guard: { type: 'isStage', params: { stage: 'atomicity' } },
        actions: ['closeThenActivate'],
      },
    ],
    'gate.presented': { target: 'gate', actions: ['presentGate'] },
  },
})

export const atomicity = kernelSetup.createStateConfig({
  on: {
    ...runAbort,
    'stage.enter': [
      {
        // Mid-atomicity crash resume re-enters through its own self-loop (C5 D4).
        target: 'atomicity',
        guard: { type: 'isStage', params: { stage: 'atomicity' } },
        actions: ['closeThenActivate'],
      },
      {
        target: 'gate',
        guard: { type: 'isStage', params: { stage: 'gate' } },
        actions: ['closeThenActivate'],
      },
    ],
    'gate.presented': { target: 'gate', actions: ['presentGate'] },
  },
})

/**
 * GATE compound (C4 D1): `awaiting` is the machine-state park of a presented
 * gate. Entries: interstitial `gate.presented` from any work stage (early
 * cap-hit, C6 escalation) or the compound's own initial child via
 * `stage.enter(gate)` (final, C5's bracket). Exits key on the legacy mover
 * events — `round.open` (extend) back to review, `stage.enter(decompose)`
 * (approve-early), `stage.enter(draft)` (veto) — plus `gate.answered` +
 * all-done → completed (existing edge), `gate.answered` outcome=abort →
 * aborted (new logs only), the C6 escalation retry movers
 * (`stage.enter(review|atomicity|intake)` re-entering the still-active failed
 * stage), and the `run_abort` mixin. Per-state edges re-declare the root
 * assigns they shadow (`openRound`, `closeThenActivate`, `presentGate`,
 * `answerGate`); re-presentation re-enters awaiting (fresh version =
 * genuinely fresh awaiting, D1).
 */
export const gate = kernelSetup.createStateConfig({
  initial: 'awaiting',
  on: {
    ...runAbort,
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
            target: '#pipeline.review',
            guard: { type: 'isStage', params: { stage: 'review' } },
            actions: ['closeThenActivate'],
          },
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
          {
            target: '#pipeline.atomicity',
            guard: { type: 'isStage', params: { stage: 'atomicity' } },
            actions: ['closeThenActivate'],
          },
          {
            target: '#pipeline.intake',
            guard: { type: 'isStage', params: { stage: 'intake' } },
            actions: ['closeThenActivate'],
          },
        ],
      },
    }),
  },
})

export const completed = kernelSetup.createStateConfig({ type: 'final' })

export const aborted = kernelSetup.createStateConfig({ type: 'final' })
