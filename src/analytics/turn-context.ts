// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AnalyticsSourceContext } from './source-facts.js'

const DEFAULT_TERMINAL_GRACE_MS = 2 * 60 * 1000
const DEFAULT_TTL_MS = 30 * 60 * 1000

export type RephraseTerminalEvidence =
  | Readonly<{ kind: 'llm_completed' }>
  | Readonly<{ kind: 'llm_failed' }>
  | Readonly<{
      kind: 'tool_completed'
      toolSlug: string
      executionOutcome: string
      recoveredSameTurn: boolean
      errorClass: string | null
    }>

export type TurnTerminalListener = (turnId: string, evidence: readonly RephraseTerminalEvidence[]) => void

export type TurnContextRegistryDeps = Readonly<{
  nowMs?: () => number
  terminalGraceMs?: number
  ttlMs?: number
}>

export type AuthorizedTurnContextRegistry = Readonly<{
  register: (input: Readonly<{ turnId: string; source: AnalyticsSourceContext }>) => void
  resolve: (turnId: string) => AnalyticsSourceContext | null
  complete: (turnId: string) => void
  noteTerminalEvidence: (turnId: string, evidence: RephraseTerminalEvidence) => void
  setTerminalListener: (listener: TurnTerminalListener | null) => void
  clear: () => void
}>

type Entry = {
  source: AnalyticsSourceContext
  registeredAtMs: number
  completedAtMs: number | null
  evidence: RephraseTerminalEvidence[]
  terminalNotified: boolean
}

type RegistryState = {
  entries: Map<string, Entry>
  nowMs: () => number
  terminalGraceMs: number
  ttlMs: number
  terminalListener: TurnTerminalListener | null
}

const isLive = (state: RegistryState, entry: Entry, now: number): boolean => {
  if (entry.completedAtMs !== null) return now < entry.completedAtMs + state.terminalGraceMs
  return now < entry.registeredAtMs + state.ttlMs
}

const resolveEntry = (state: RegistryState, turnId: string): AnalyticsSourceContext | null => {
  const entry = state.entries.get(turnId)
  if (entry === undefined) return null
  if (!isLive(state, entry, state.nowMs())) {
    state.entries.delete(turnId)
    return null
  }
  return entry.source
}

const completeEntry = (state: RegistryState, turnId: string): void => {
  const entry = state.entries.get(turnId)
  if (entry === undefined) return
  entry.completedAtMs = state.nowMs()
  if (entry.terminalNotified) return
  entry.terminalNotified = true
  if (state.terminalListener !== null) {
    state.terminalListener(turnId, entry.evidence)
  }
}

export const createTurnContextRegistry = (deps: TurnContextRegistryDeps = {}): AuthorizedTurnContextRegistry => {
  const state: RegistryState = {
    entries: new Map(),
    nowMs: deps.nowMs ?? ((): number => Date.now()),
    terminalGraceMs: deps.terminalGraceMs ?? DEFAULT_TERMINAL_GRACE_MS,
    ttlMs: deps.ttlMs ?? DEFAULT_TTL_MS,
    terminalListener: null,
  }

  return {
    register: (input) => {
      state.entries.set(input.turnId, {
        source: input.source,
        registeredAtMs: state.nowMs(),
        completedAtMs: null,
        evidence: [],
        terminalNotified: false,
      })
    },
    resolve: (turnId) => resolveEntry(state, turnId),
    complete: (turnId) => {
      completeEntry(state, turnId)
    },
    noteTerminalEvidence: (turnId, evidence) => {
      const entry = state.entries.get(turnId)
      if (entry === undefined) return
      entry.evidence.push(evidence)
    },
    setTerminalListener: (listener) => {
      state.terminalListener = listener
    },
    clear: () => {
      state.entries.clear()
      state.terminalListener = null
    },
  }
}
