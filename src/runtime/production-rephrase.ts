// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Pseudonym } from '../analytics/controlled-types.js'
import type { KeyringState } from '../analytics/identity/keyring.js'
import { parseAnalyticsKeyring } from '../analytics/identity/keyring.js'
import { createPseudonym } from '../analytics/identity/pseudonym.js'
import { buildIdentityKeys } from '../analytics/identity/scope.js'
import type {
  RephraseBoundaryDeps,
  RephraseBoundaryKeys,
  RephraseHandoffHandle,
} from '../analytics/rephrase/handoff.js'
import { createRephraseHandoff } from '../analytics/rephrase/handoff.js'
import { resolveRephraseTerminalOutcome } from '../analytics/rephrase/outcome.js'
import type { RephraseInspection } from '../analytics/rephrase/state.js'
import type { AnalyticsObserver } from '../analytics/runtime.js'
import type { AuthorizedTurnContextRegistry, TurnTerminalListener } from '../analytics/turn-context.js'
import { parseScopedContextId } from '../chat/scoped-context.js'
import { getPlatformInstance } from '../instances/platform-store.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'analytics:rephrase' })

const MAX_SOURCE_INDEX = 256

type IdentityRole = 'admin' | 'member' | 'guest' | 'system'

const toIdentityRole = (role: string): IdentityRole | null =>
  role === 'admin' || role === 'member' || role === 'guest' || role === 'system' ? role : null

export type ProductionRephraseInput = Readonly<{
  observer: AnalyticsObserver
  registry: AuthorizedTurnContextRegistry
  keyring: KeyringState
  nowMs?: () => number
}>

export type ProductionRephraseBundle = Readonly<{
  boundary: RephraseBoundaryDeps
  withdrawFor: (platformInstanceId: string, platformUserId: string) => void
  inspect: () => RephraseInspection
  dispose: () => void
}>

type ActiveKey = Readonly<{ key: Buffer; keyVersion: string }>

const activeKeyOf = (keyring: KeyringState): ActiveKey | null =>
  keyring.kind === 'available' ? { key: keyring.activeKey, keyVersion: keyring.activeVersion } : null

const deriveBoundaryKeys = (
  active: ActiveKey,
  input: Readonly<{ storageContextId: string; chatUserId: string; rawTurnId: string; actorRole: string }>,
): RephraseBoundaryKeys | null => {
  const actorRole = toIdentityRole(input.actorRole)
  if (actorRole === null) return null
  const scoped = parseScopedContextId(input.storageContextId)
  if (scoped === null) return null
  const instance = getPlatformInstance(scoped.platformInstanceId)
  if (instance === null) return null
  const keys = buildIdentityKeys({
    key: active.key,
    keyVersion: active.keyVersion,
    platform: instance.type,
    platformInstanceId: scoped.platformInstanceId,
    storageContextId: input.storageContextId,
    chatUserId: input.chatUserId,
    actorRole,
    rawTurnId: input.rawTurnId,
    taskInstanceId: null,
    sessionStartMs: null,
    firstEventId: null,
  })
  if (keys.actor_key === null || keys.conversation_key === null || keys.turn_key === null) return null
  return { actorKey: keys.actor_key, conversationKey: keys.conversation_key, turnKey: keys.turn_key }
}

const noteSource = (sourceIndex: Map<Pseudonym, string>, turnKey: Pseudonym, rawTurnId: string): void => {
  sourceIndex.delete(turnKey)
  sourceIndex.set(turnKey, rawTurnId)
  while (sourceIndex.size > MAX_SOURCE_INDEX) {
    const oldest = sourceIndex.keys().next().value
    if (oldest === undefined) break
    sourceIndex.delete(oldest)
  }
}

const emitPair = (
  input: ProductionRephraseInput,
  sourceIndex: Map<Pseudonym, string>,
  nowMs: () => number,
  pair: Readonly<{ laterTurnKey: Pseudonym; detector: string; similarity: string; priorOutcome: string; gap: string }>,
): void => {
  const rawTurnId = sourceIndex.get(pair.laterTurnKey)
  if (rawTurnId === undefined) {
    log.warn('rephrase pair dropped: later turn source unknown')
    return
  }
  const source = input.registry.resolve(rawTurnId)
  if (source === null) {
    log.warn('rephrase pair dropped: later turn context expired')
    return
  }
  input.observer.observe({
    version: 1,
    type: 'rephrase_detected',
    sourceEventId: `rephrase:${rawTurnId}`,
    occurredAtMs: nowMs(),
    source,
    detector: pair.detector,
    similarity: pair.similarity,
    priorOutcome: pair.priorOutcome,
    gap: pair.gap,
  })
}

const createTerminalListener = (
  active: ActiveKey,
  handle: RephraseHandoffHandle,
  sourceIndex: Map<Pseudonym, string>,
  nowMs: () => number,
): TurnTerminalListener => {
  const turnKeyFor = (rawTurnId: string): Pseudonym =>
    createPseudonym({ key: active.key, keyVersion: active.keyVersion, domain: 'turn:v1', components: [rawTurnId] })
  return (turnId, evidence) => {
    const turnKey = turnKeyFor(turnId)
    noteSource(sourceIndex, turnKey, turnId)
    handle.handoff.completeTurn({
      turnKey,
      completedAtMs: nowMs(),
      outcome: resolveRephraseTerminalOutcome(evidence),
    })
  }
}

export const createProductionRephrase = (input: ProductionRephraseInput): ProductionRephraseBundle | null => {
  const active = activeKeyOf(input.keyring)
  if (active === null) return null
  const nowMs = input.nowMs ?? ((): number => Date.now())
  const sourceIndex = new Map<Pseudonym, string>()
  const handle = createRephraseHandoff({
    nowMs,
    onPairDetected: (pair) => {
      emitPair(input, sourceIndex, nowMs, pair)
    },
    onCoverageLoss: (reason) => {
      log.warn({ reason }, 'rephrase coverage loss')
    },
  })
  input.registry.setTerminalListener(createTerminalListener(active, handle, sourceIndex, nowMs))
  return {
    boundary: {
      handoff: handle.handoff,
      deriveKeys: (deriverInput) => deriveBoundaryKeys(active, deriverInput),
      noteTurnSource: (turnKey, rawTurnId) => {
        noteSource(sourceIndex, turnKey, rawTurnId)
      },
      nowMs,
    },
    withdrawFor: (platformInstanceId, platformUserId) => {
      handle.handoff.withdraw({
        actorKey: createPseudonym({
          key: active.key,
          keyVersion: active.keyVersion,
          domain: 'actor:v1',
          components: [platformInstanceId, platformUserId],
        }),
      })
    },
    inspect: () => handle.inspect(),
    dispose: () => {
      handle.dispose()
    },
  }
}

const activeByRegistry = new WeakMap<AuthorizedTurnContextRegistry, ProductionRephraseBundle>()

export const ensureProductionRephrase = (input: ProductionRephraseInput): ProductionRephraseBundle | null => {
  const existing = activeByRegistry.get(input.registry)
  if (existing !== undefined) return existing
  const created = createProductionRephrase(input)
  if (created !== null) {
    activeByRegistry.set(input.registry, created)
  }
  return created
}

export type ProductionRephraseRuntime = Readonly<{
  observer: AnalyticsObserver
  registry: AuthorizedTurnContextRegistry
  keyring?: KeyringState
}>

export const resolveProductionRephrase = (
  analytics: ProductionRephraseRuntime | null,
): ProductionRephraseBundle | null =>
  analytics === null
    ? null
    : ensureProductionRephrase({
        observer: analytics.observer,
        registry: analytics.registry,
        keyring: analytics.keyring ?? parseAnalyticsKeyring(),
      })
