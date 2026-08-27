// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { assign, initialTransition, setup, transition } from 'xstate'
import type { ExecutableActionsFrom, SnapshotFrom } from 'xstate'

export type StageStatus = 'pending' | 'active' | 'done'

export interface KernelContext {
  readonly stages: Readonly<Record<string, StageStatus>>
}

export type KernelEvent =
  | { readonly type: 'stage.enter'; readonly stage: string }
  | { readonly type: 'stage.exit'; readonly stage: string }
  | { readonly type: 'gate.presented' }
  | { readonly type: 'gate.answered' }
export const kernelSetup = setup({
  types: {
    context: {} as KernelContext,
    events: {} as KernelEvent,
  },
  guards: {
    isStage: ({ event }, params: { stage: string }) => event.type === 'stage.enter' && event.stage === params.stage,
    allStagesDone: ({ context }) => Object.values(context.stages).every((status) => status === 'done'),
  },
  actions: {
    closeThenActivate: assign(({ context, event }) => {
      if (event.type !== 'stage.enter') return {}
      const stages: Record<string, StageStatus> = { ...context.stages }
      for (const id of Object.keys(stages)) if (stages[id] === 'active') stages[id] = 'done'
      stages[event.stage] = 'active'
      return { stages }
    }),
    markStageDone: assign(({ context, event }) => {
      if (event.type !== 'stage.exit') return {}
      return { stages: { ...context.stages, [event.stage]: 'done' } }
    }),
    emit: (_args, _params: { event: KernelEvent }): undefined => undefined,
    schedule: (_args, _params: { work: { kind: string } }): undefined => undefined,
  },
})

export type KernelMachine = ReturnType<typeof kernelSetup.createMachine>
export type KernelSnapshot = SnapshotFrom<KernelMachine>
export type KernelActions = readonly ExecutableActionsFrom<KernelMachine>[]
export type KernelStep = [snapshot: KernelSnapshot, actions: KernelActions]

export function createKernelMachine(config: Parameters<typeof kernelSetup.createMachine>[0]): KernelMachine {
  return kernelSetup.createMachine(config)
}

export function initialStep(machine: KernelMachine): KernelStep {
  return initialTransition(machine)
}

export function step(machine: KernelMachine, snapshot: KernelSnapshot, event: KernelEvent): KernelStep {
  return transition(machine, snapshot, event)
}
