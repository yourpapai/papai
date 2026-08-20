// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readEvents } from './events.js'
import { STAGE_ORDER } from './events.js'
import type { AutoDecisionRule, DepthProfile, EventInput, FindingCounts, StageId } from './events.js'

export interface DigestRecord {
  readonly round: number
  readonly counts: FindingCounts
  readonly resolved: number
  readonly dismissed: number
  readonly verdict: 'converged' | 'open'
}

export interface AutoDecisionRecord {
  readonly rule: AutoDecisionRule
  readonly decision: 'preview' | 'approve' | 'extend' | 'accept-items' | 'gate'
  readonly evidenceDigest: string
  readonly gateVersion: number
  readonly seq: number
  readonly ts: string
}

export interface ReplayState {
  readonly stages: Record<StageId, 'done' | 'active' | 'pending'>
  readonly depth: DepthProfile | null
  readonly round: { readonly current: number; readonly cap: number } | null
  readonly perRound: readonly DigestRecord[]
  readonly lastVerdict: DigestRecord | null
  readonly gate: { readonly mode: 'early' | 'final'; readonly version: number; readonly answered: boolean } | null
  readonly autoDecisions: readonly AutoDecisionRecord[]
}

interface RoundDigest {
  resolved: number
  dismissed: number
}

function initialStages(): Record<StageId, 'done' | 'active' | 'pending'> {
  return {
    intake: 'pending',
    draft: 'pending',
    review: 'pending',
    decompose: 'pending',
    atomicity: 'pending',
    gate: 'pending',
  }
}

export function initialReplayState(): ReplayState {
  return {
    stages: initialStages(),
    depth: null,
    round: null,
    perRound: [],
    lastVerdict: null,
    gate: null,
    autoDecisions: [],
  }
}

function foldEvent(state: ReplayState, event: EventInput, pending: Map<number, RoundDigest>): ReplayState {
  if (event.type === 'stage_enter') {
    const stages = { ...state.stages }
    for (const id of STAGE_ORDER) if (stages[id] === 'active') stages[id] = 'done'
    stages[event.stage] = 'active'
    return { ...state, stages }
  }
  if (event.type === 'stage_exit') return { ...state, stages: { ...state.stages, [event.stage]: 'done' } }
  if (event.type === 'depth') return { ...state, depth: event.profile }
  if (event.type === 'round_open') return { ...state, round: { current: event.round, cap: event.cap } }
  if (event.type === 'finding') {
    if (event.action === 'resolved' || event.action === 'dismissed') {
      const entry = pending.get(event.round) ?? { resolved: 0, dismissed: 0 }
      entry[event.action] += 1
      pending.set(event.round, entry)
    }
    return state
  }
  if (event.type === 'convergence') {
    const counts = pending.get(event.round) ?? { resolved: 0, dismissed: 0 }
    pending.delete(event.round)
    const record: DigestRecord = {
      round: event.round,
      counts: event.counts,
      resolved: counts.resolved,
      dismissed: counts.dismissed,
      verdict: event.verdict,
    }
    const perRound = [...state.perRound, record]
    return { ...state, perRound, lastVerdict: record }
  }
  if (event.type === 'auto_decision') {
    const raw: Record<string, unknown> = event
    const record: AutoDecisionRecord = {
      rule: event.rule,
      decision: event.decision,
      evidenceDigest: event.evidenceDigest,
      gateVersion: event.gateVersion,
      seq: typeof raw['seq'] === 'number' ? raw['seq'] : 0,
      ts: typeof raw['ts'] === 'string' ? raw['ts'] : '',
    }
    return { ...state, autoDecisions: [...state.autoDecisions, record] }
  }
  if (event.type === 'gate') {
    if (event.action === 'presented')
      return { ...state, gate: { mode: event.mode, version: event.version, answered: false } }
    return state.gate === null ? state : { ...state, gate: { ...state.gate, answered: true } }
  }
  return state
}

export function replayEvents(logPath: string): ReplayState {
  const events = readEvents(logPath)
  const pending = new Map<number, RoundDigest>()
  return events.reduce((state, event) => foldEvent(state, event, pending), initialReplayState())
}

export interface ReplayFolder {
  readonly fold: (event: EventInput) => ReplayState
  readonly state: ReplayState
}

export function createReplayFolder(): ReplayFolder {
  const pending = new Map<number, RoundDigest>()
  let current = initialReplayState()
  return {
    fold: (event) => {
      current = foldEvent(current, event, pending)
      return current
    },
    get state(): ReplayState {
      return current
    },
  }
}
