// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { assign, initialTransition, setup, transition } from 'xstate'
import type { ExecutableActionsFrom, SnapshotFrom } from 'xstate'

import type {
  AutoDecisionKind,
  AutoDecisionRule,
  DepthProfile,
  FailureKind,
  FindingCounts,
  GateOutcome,
} from '../events.js'
import type { AutoDecisionRecord, DigestRecord } from '../legacy-fold.js'

export type StageStatus = 'pending' | 'active' | 'done'

export interface RoundStatus {
  readonly current: number
  readonly cap: number
}

export interface GateRecord {
  readonly mode: 'early' | 'final' | 'plan'
  readonly version: number
  readonly answered: boolean
}

export type ChildStatus = 'pending' | 'running' | 'done' | 'failed'

export interface ChildRecord {
  readonly status: ChildStatus
}

/** Scratch tally accumulator: findings counted per round until the round's convergence flushes them. */
export interface TallyCounts {
  readonly resolved: number
  readonly dismissed: number
}

export type RoundTally = Readonly<Record<number, TallyCounts>>

export interface KernelContext {
  readonly stages: Readonly<Record<string, StageStatus>>
  readonly depth: DepthProfile | null
  readonly round: RoundStatus | null
  readonly perRound: readonly DigestRecord[]
  readonly lastVerdict: DigestRecord | null
  readonly gate: GateRecord | null
  readonly autoDecisions: readonly AutoDecisionRecord[]
  readonly children: Readonly<Record<string, ChildRecord>>
  readonly tally: RoundTally
  /**
   * Non-projected gate residue (C4, like the tally — never a parity field):
   * the latest explicit answered outcome and the presented deadline stamp,
   * null on historical logs and re-cleared by every presentation.
   */
  readonly gateOutcome: GateOutcome | null
  readonly gateDeadlineAt: string | null
  /** Whether this gate version's deadline was already re-armed once (D4). */
  readonly gateDeadlineReArmed: boolean
  /**
   * Non-projected failure residue (C6 D2, like the tally): per-stage
   * consecutive declared-failure counts, cleared by that stage's exit and by
   * escalation-extend — never a parity field.
   */
  readonly failures: Readonly<Record<string, number>>
}

export function initialKernelContext(stages: Readonly<Record<string, StageStatus>>): KernelContext {
  return {
    stages,
    depth: null,
    round: null,
    perRound: [],
    lastVerdict: null,
    gate: null,
    autoDecisions: [],
    children: {},
    tally: {},
    gateOutcome: null,
    gateDeadlineAt: null,
    gateDeadlineReArmed: false,
    failures: {},
  }
}

export type KernelEvent =
  | { readonly type: 'stage.enter'; readonly stage: string }
  | { readonly type: 'stage.exit'; readonly stage: string }
  | { readonly type: 'stage.failed'; readonly stage: string; readonly kind: FailureKind }
  | { readonly type: 'depth'; readonly profile: DepthProfile }
  | { readonly type: 'round.open'; readonly round: number; readonly cap: number }
  | { readonly type: 'round.close'; readonly round: number; readonly cap: number }
  | {
      readonly type: 'finding'
      readonly action: 'filed' | 'classified' | 'resolved' | 'dismissed'
      readonly round: number
    }
  | {
      readonly type: 'convergence'
      readonly round: number
      readonly verdict: 'converged' | 'open'
      readonly counts: FindingCounts
    }
  | {
      readonly type: 'gate.presented'
      readonly mode: GateRecord['mode']
      readonly version: number
      readonly deadlineAt?: string
    }
  | { readonly type: 'gate.answered'; readonly outcome?: GateOutcome }
  | { readonly type: 'gate.rearmed'; readonly version: number; readonly deadlineAt: string }
  | {
      readonly type: 'auto.decision'
      readonly rule: AutoDecisionRule
      readonly decision: AutoDecisionKind
      readonly evidenceDigest: string
      readonly gateVersion: number
      readonly seq: number
      readonly ts: string
    }
  | { readonly type: 'plan' }
  | { readonly type: 'child.spawned'; readonly child: string }
  | { readonly type: 'child.done'; readonly child: string; readonly outcome: 'done' | 'failed' }
export const kernelSetup = setup({
  types: {
    context: {} as KernelContext,
    events: {} as KernelEvent,
  },
  guards: {
    isStage: ({ event }, params: { stage: string }) => event.type === 'stage.enter' && event.stage === params.stage,
    /**
     * C5 reshape (D4): the gate stage done and nothing active — the all-done
     * requirement made depth-S completion graph-impossible (the map is
     * pre-initialized all-pending, so atomicity never leaves `pending` on an
     * S run). Guard-equivalent over every historical answered: interstitial
     * gates keep the gate stage pending (blocked), completed shapes have all
     * done (fires) — the only flip is the intended S final approve.
     */
    allStagesDone: ({ context }) =>
      context.stages['gate'] === 'done' && Object.values(context.stages).every((status) => status !== 'active'),
    /** Abort exits are new-log-only (D2): a historical answered event carries no outcome and never aborts. */
    isAbortOutcome: ({ event }) => event.type === 'gate.answered' && event.outcome === 'abort',
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
      // A stage's exit closes its bracket successfully — its failure ledger
      // entry resets (C6 D2: a later failure of the same stage counts fresh).
      const failures = Object.fromEntries(Object.entries(context.failures).filter(([stage]) => stage !== event.stage))
      return { stages: { ...context.stages, [event.stage]: 'done' }, failures }
    }),
    recordFailure: assign(({ context, event }) => {
      if (event.type !== 'stage.failed') return {}
      return {
        failures: { ...context.failures, [event.stage]: (context.failures[event.stage] ?? 0) + 1 },
      }
    }),
    setDepth: assign(({ event }) => {
      if (event.type !== 'depth') return {}
      return { depth: event.profile }
    }),
    openRound: assign(({ event }) => {
      if (event.type !== 'round.open') return {}
      return { round: { current: event.round, cap: event.cap } }
    }),
    tallyFinding: assign(({ context, event }) => {
      if (event.type !== 'finding') return {}
      if (event.action !== 'resolved' && event.action !== 'dismissed') return {}
      const current = context.tally[event.round] ?? { resolved: 0, dismissed: 0 }
      const next: TallyCounts =
        event.action === 'resolved'
          ? { resolved: current.resolved + 1, dismissed: current.dismissed }
          : { resolved: current.resolved, dismissed: current.dismissed + 1 }
      return { tally: { ...context.tally, [event.round]: next } }
    }),
    flushConvergence: assign(({ context, event }) => {
      if (event.type !== 'convergence') return {}
      const counts = context.tally[event.round] ?? { resolved: 0, dismissed: 0 }
      const rest: RoundTally = Object.fromEntries(
        Object.entries(context.tally).filter(([round]) => Number(round) !== event.round),
      )
      const record: DigestRecord = {
        round: event.round,
        counts: event.counts,
        resolved: counts.resolved,
        dismissed: counts.dismissed,
        verdict: event.verdict,
      }
      return { tally: rest, perRound: [...context.perRound, record], lastVerdict: record }
    }),
    presentGate: assign(({ event }) => {
      if (event.type !== 'gate.presented') return {}
      return {
        gate: { mode: event.mode, version: event.version, answered: false },
        gateOutcome: null,
        gateDeadlineAt: event.deadlineAt ?? null,
        gateDeadlineReArmed: false,
      }
    }),
    reArmGate: assign(({ event }) => {
      if (event.type !== 'gate.rearmed') return {}
      return { gateDeadlineAt: event.deadlineAt, gateDeadlineReArmed: true }
    }),
    answerGate: assign(({ context, event }) => {
      if (event.type !== 'gate.answered') return {}
      if (context.gate === null) return {}
      return {
        gate: { ...context.gate, answered: true },
        ...(event.outcome === undefined ? {} : { gateOutcome: event.outcome }),
      }
    }),
    recordAutoDecision: assign(({ context, event }) => {
      if (event.type !== 'auto.decision') return {}
      const record: AutoDecisionRecord = {
        rule: event.rule,
        decision: event.decision,
        evidenceDigest: event.evidenceDigest,
        gateVersion: event.gateVersion,
        seq: event.seq,
        ts: event.ts,
      }
      return { autoDecisions: [...context.autoDecisions, record] }
    }),
    resetChildren: assign(() => ({ children: {} })),
    spawnChild: assign(({ context, event }) => {
      if (event.type !== 'child.spawned') return {}
      return { children: { ...context.children, [event.child]: { status: 'running' } } }
    }),
    finishChild: assign(({ context, event }) => {
      if (event.type !== 'child.done') return {}
      return { children: { ...context.children, [event.child]: { status: event.outcome } } }
    }),
    emit: (_args, _params: { event: KernelEvent }): undefined => undefined,
    schedule: (_args, _params: { work: { kind: string } }): undefined => undefined,
  },
})

export type KernelMachine = ReturnType<typeof kernelSetup.createMachine>
export type KernelSnapshot = SnapshotFrom<KernelMachine>
export type KernelActions = readonly ExecutableActionsFrom<KernelMachine>[]
export type KernelStep = [snapshot: KernelSnapshot, actions: KernelActions]

/**
 * The root-level target-less bookkeeping vocabulary: everything except
 * enters. Enter edges stay per-state topology; these handlers fire from any
 * state (finals included) and never move position — the mechanism proven for
 * `stage.exit`, extended to the full derived state. Graphs compose this
 * record as their root `on`.
 */
type KernelMachineConfig = Parameters<typeof kernelSetup.createMachine>[0]

export const kernelRootHandlers: NonNullable<KernelMachineConfig['on']> = {
  'stage.exit': { actions: ['markStageDone'] },
  'stage.failed': { actions: ['recordFailure'] },
  depth: { actions: ['setDepth'] },
  'round.open': { actions: ['openRound'] },
  'round.close': { actions: [] },
  finding: { actions: ['tallyFinding'] },
  convergence: { actions: ['flushConvergence'] },
  'gate.presented': { actions: ['presentGate'] },
  'gate.answered': { actions: ['answerGate'] },
  'gate.rearmed': { actions: ['reArmGate'] },
  'auto.decision': { actions: ['recordAutoDecision'] },
  plan: { actions: ['resetChildren'] },
  'child.spawned': { actions: ['spawnChild'] },
  'child.done': { actions: ['finishChild'] },
}

export function createKernelMachine(config: Parameters<typeof kernelSetup.createMachine>[0]): KernelMachine {
  return kernelSetup.createMachine(config)
}

export function initialStep(machine: KernelMachine): KernelStep {
  return initialTransition(machine)
}

export function step(machine: KernelMachine, snapshot: KernelSnapshot, event: KernelEvent): KernelStep {
  return transition(machine, snapshot, event)
}
