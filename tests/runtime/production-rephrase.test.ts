// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { KeyringState } from '../../src/analytics/identity/keyring.js'
import type { RephraseBoundaryDeps, RephraseBoundaryKeys } from '../../src/analytics/rephrase/handoff.js'
import type { AnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsSourceContext, AnalyticsSourceFact } from '../../src/analytics/source-facts.js'
import { createTurnContextRegistry } from '../../src/analytics/turn-context.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { createProductionRephrase } from '../../src/runtime/production-rephrase.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

const KEY = Buffer.alloc(32, 7)
const T0 = 1_700_000_000_000
const PLATFORM_INSTANCE_ID = 'test-instance'
const USER_ID = 'user-42'
const TEXT = 'please create a task to review the lighthouse budget report'

const keyring: KeyringState = { kind: 'available', activeVersion: 'v1', activeKey: KEY, keys: new Map([['v1', KEY]]) }

const sourceFor = (rawTurnId: string): AnalyticsSourceContext => ({
  platform: 'telegram',
  platformInstanceId: PLATFORM_INSTANCE_ID,
  chatUserId: USER_ID,
  nativeContextId: USER_ID,
  storageContextId: toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: USER_ID }),
  configContextId: toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: USER_ID }),
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId,
})

const createObserver = (): AnalyticsObserver & { facts: AnalyticsSourceFact[] } => {
  const facts: AnalyticsSourceFact[] = []
  return {
    facts,
    observe: (fact) => {
      facts.push(fact)
    },
    flush: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  }
}

const derive = (boundary: RephraseBoundaryDeps, rawTurnId: string, actorRole = 'member'): RephraseBoundaryKeys | null =>
  boundary.deriveKeys({
    storageContextId: toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: USER_ID }),
    chatUserId: USER_ID,
    rawTurnId,
    actorRole,
  })

describe('createProductionRephrase', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('returns null without an available keyring', () => {
    const observer = createObserver()
    const registry = createTurnContextRegistry({ nowMs: () => T0 })
    expect(createProductionRephrase({ observer, registry, keyring: { kind: 'unavailable' } })).toBeNull()
  })

  test('derives boundary keys for members and refuses guests and unknown contexts', () => {
    const observer = createObserver()
    const registry = createTurnContextRegistry({ nowMs: () => T0 })
    const bundle = createProductionRephrase({ observer, registry, keyring, nowMs: () => T0 })
    expect(bundle).not.toBeNull()
    assert.ok(bundle !== null)
    const keys = derive(bundle.boundary, 'turn-1')
    expect(keys).not.toBeNull()
    expect(derive(bundle.boundary, 'turn-1', 'guest')).toBeNull()
    expect(
      bundle.boundary.deriveKeys({
        storageContextId: 'not-a-scoped-context',
        chatUserId: USER_ID,
        rawTurnId: 'turn-1',
        actorRole: 'member',
      }),
    ).toBeNull()
  })

  test('a rephrased pair emits one governed rephrase_detected fact through the observer', () => {
    const observer = createObserver()
    const registry = createTurnContextRegistry({ nowMs: () => T0 })
    const bundle = createProductionRephrase({ observer, registry, keyring, nowMs: () => T0 })
    assert.ok(bundle !== null)

    const firstKeys = derive(bundle.boundary, 'turn-1')
    assert.ok(firstKeys !== null)
    registry.register({ turnId: 'turn-1', source: sourceFor('turn-1') })
    bundle.boundary.noteTurnSource?.(firstKeys.turnKey, 'turn-1')
    bundle.boundary.handoff.captureText({
      actorKey: firstKeys.actorKey,
      conversationKey: firstKeys.conversationKey,
      turnKey: firstKeys.turnKey,
      capturedAtMs: T0,
      text: TEXT,
    })
    registry.noteTerminalEvidence('turn-1', {
      kind: 'tool_completed',
      toolSlug: 'create_task',
      executionOutcome: 'structured_failure',
      recoveredSameTurn: false,
      errorClass: 'validation',
    })
    registry.complete('turn-1')

    const secondKeys = derive(bundle.boundary, 'turn-2')
    assert.ok(secondKeys !== null)
    registry.register({ turnId: 'turn-2', source: sourceFor('turn-2') })
    bundle.boundary.noteTurnSource?.(secondKeys.turnKey, 'turn-2')
    bundle.boundary.handoff.captureText({
      actorKey: secondKeys.actorKey,
      conversationKey: secondKeys.conversationKey,
      turnKey: secondKeys.turnKey,
      capturedAtMs: T0 + 30_000,
      text: TEXT,
    })

    const facts = observer.facts.filter((fact) => fact.type === 'rephrase_detected')
    expect(facts).toHaveLength(1)
    const fact = facts[0]
    assert.ok(fact !== undefined)
    assert.ok(fact.type === 'rephrase_detected')
    expect(fact.sourceEventId).toBe('rephrase:turn-2')
    expect(fact.source.rawTurnId).toBe('turn-2')
    expect(fact.detector).toBe('lexical_v1')
    expect(fact.similarity).toBe('ge_095')
    expect(fact.priorOutcome).toBe('clarification')
    expect(fact.gap).toBe('le_2m')
    expect(JSON.stringify(fact)).not.toContain('lighthouse')
  })

  test('the terminal listener resolves outcomes and discard markers consume late captures', () => {
    const observer = createObserver()
    const registry = createTurnContextRegistry({ nowMs: () => T0 })
    const bundle = createProductionRephrase({ observer, registry, keyring, nowMs: () => T0 })
    assert.ok(bundle !== null)

    registry.register({ turnId: 'turn-9', source: sourceFor('turn-9') })
    registry.complete('turn-9')
    const keys = derive(bundle.boundary, 'turn-9')
    assert.ok(keys !== null)
    bundle.boundary.handoff.captureText({
      actorKey: keys.actorKey,
      conversationKey: keys.conversationKey,
      turnKey: keys.turnKey,
      capturedAtMs: T0 + 1_000,
      text: TEXT,
    })
    expect(bundle.inspect().conversations).toHaveLength(0)
  })

  test('withdrawFor removes every pending set for the actor', () => {
    const observer = createObserver()
    const registry = createTurnContextRegistry({ nowMs: () => T0 })
    const bundle = createProductionRephrase({ observer, registry, keyring, nowMs: () => T0 })
    assert.ok(bundle !== null)
    const keys = derive(bundle.boundary, 'turn-1')
    assert.ok(keys !== null)
    bundle.boundary.handoff.captureText({
      actorKey: keys.actorKey,
      conversationKey: keys.conversationKey,
      turnKey: keys.turnKey,
      capturedAtMs: T0,
      text: TEXT,
    })
    expect(bundle.inspect().conversations).toHaveLength(1)
    bundle.withdrawFor(PLATFORM_INSTANCE_ID, USER_ID)
    expect(bundle.inspect().conversations).toHaveLength(0)
  })
})
