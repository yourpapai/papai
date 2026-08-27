// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { STAGE_ORDER } from '../events.js'
import { createKernelMachine, initialKernelContext } from '../kernel/machine.js'
import type { StageStatus } from '../kernel/machine.js'
import {
  aborted,
  atomicity,
  completed,
  decompose,
  draft,
  gate,
  intake,
  review,
  start,
} from './states/pipeline-states.js'

export { aborted, atomicity, completed, decompose, draft, gate, intake, review, start }

export const pipelineStates = {
  start,
  intake,
  draft,
  review,
  decompose,
  atomicity,
  gate,
  completed,
  aborted,
}

type PipelineMachineConfig = Parameters<typeof createKernelMachine>[0]

/**
 * Root-level target-less bookkeeping: everything except enters. Enter edges stay
 * per-state topology; these handlers fire from any state (finals included) and
 * never move position — the mechanism proven for `stage.exit`, extended to the
 * full derived state.
 */
export const pipelineRootHandlers: NonNullable<PipelineMachineConfig['on']> = {
  'stage.exit': { actions: ['markStageDone'] },
  depth: { actions: ['setDepth'] },
  'round.open': { actions: ['openRound'] },
  'round.close': { actions: [] },
  finding: { actions: ['tallyFinding'] },
  convergence: { actions: ['flushConvergence'] },
  'gate.presented': { actions: ['presentGate'] },
  'gate.answered': { actions: ['answerGate'] },
  'auto.decision': { actions: ['recordAutoDecision'] },
  plan: { actions: ['resetChildren'] },
  'child.spawned': { actions: ['spawnChild'] },
  'child.done': { actions: ['finishChild'] },
}

function initialStages(): Record<string, StageStatus> {
  return Object.fromEntries(STAGE_ORDER.map((stage) => [stage, 'pending' as const]))
}

export const pipelineMachine = createKernelMachine({
  id: 'pipeline',
  initial: 'start',
  context: initialKernelContext(initialStages()),
  on: pipelineRootHandlers,
  states: pipelineStates,
})
