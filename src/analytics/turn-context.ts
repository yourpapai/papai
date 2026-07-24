// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AnalyticsSourceContext } from './source-facts.js'

const DEFAULT_TERMINAL_GRACE_MS = 2 * 60 * 1000
const DEFAULT_TTL_MS = 30 * 60 * 1000

export type TurnContextRegistryDeps = Readonly<{
  nowMs?: () => number
  terminalGraceMs?: number
  ttlMs?: number
}>

export type AuthorizedTurnContextRegistry = Readonly<{
  register: (input: Readonly<{ turnId: string; source: AnalyticsSourceContext }>) => void
  resolve: (turnId: string) => AnalyticsSourceContext | null
  complete: (turnId: string) => void
  clear: () => void
}>

type Entry = {
  source: AnalyticsSourceContext
  registeredAtMs: number
  completedAtMs: number | null
}

export const createTurnContextRegistry = (deps: TurnContextRegistryDeps = {}): AuthorizedTurnContextRegistry => {
  const nowMs = deps.nowMs ?? ((): number => Date.now())
  const terminalGraceMs = deps.terminalGraceMs ?? DEFAULT_TERMINAL_GRACE_MS
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS
  const entries = new Map<string, Entry>()

  const isLive = (entry: Entry, now: number): boolean => {
    if (entry.completedAtMs !== null) return now < entry.completedAtMs + terminalGraceMs
    return now < entry.registeredAtMs + ttlMs
  }

  return {
    register: (input) => {
      entries.set(input.turnId, { source: input.source, registeredAtMs: nowMs(), completedAtMs: null })
    },
    resolve: (turnId) => {
      const entry = entries.get(turnId)
      if (entry === undefined) return null
      if (!isLive(entry, nowMs())) {
        entries.delete(turnId)
        return null
      }
      return entry.source
    },
    complete: (turnId) => {
      const entry = entries.get(turnId)
      if (entry === undefined) return
      entry.completedAtMs = nowMs()
    },
    clear: () => {
      entries.clear()
    },
  }
}
