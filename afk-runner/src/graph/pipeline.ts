// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { STAGE_ORDER } from '../events.js'
import { createKernelMachine } from '../kernel/machine.js'
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

function initialStages(): Record<string, StageStatus> {
  return Object.fromEntries(STAGE_ORDER.map((stage) => [stage, 'pending' as const]))
}

export const pipelineMachine = createKernelMachine({
  id: 'pipeline',
  initial: 'start',
  context: { stages: initialStages() },
  on: {
    'stage.exit': { actions: ['markStageDone'] },
    'gate.presented': { actions: [] },
  },
  states: pipelineStates,
})
