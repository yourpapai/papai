// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { KeyVersionSchema, VersionStringSchema } from '../../src/analytics/controlled-types.js'
import type { EligibilityDecision } from '../../src/analytics/governance/eligibility.js'
import type { NormalizerEnv } from '../../src/analytics/normalizer.js'
import { createAnalyticsObserver } from '../../src/analytics/runtime.js'
import { createRecordingHealth, createRecordingSinks } from '../../src/analytics/runtime.testing.js'
import { createTurnContextRegistry } from '../../src/analytics/turn-context.js'
import { setupBot, type BotDeps } from '../../src/bot.js'
import type { ReplyFn } from '../../src/chat/types.js'
import { runRegistry } from '../../src/run-control/registry.js'
import { addUser } from '../../src/users.js'
import {
  createDmMessage,
  createMockChatForBot,
  createMockReply,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
  waitFor,
} from '../utils/test-helpers.js'

const TEST_PLATFORM_ID = 'test-instance'
const ADMIN_ID = 'admin-analytics-integration'
const USER_ID = 'int-user'

function decideAlwaysPseudonymous(): EligibilityDecision {
  return {
    allowed: true,
    lane: 'local_pseudonymous',
    policyVersion: 0,
    collectionEligibility: { refKey: 'integration-ref', keyVersion: 'v1', generation: 1 },
    deliveryGrant: null,
  }
}

function createIntegrationNormalizerEnv(): NormalizerEnv {
  return {
    hmacKey: Buffer.alloc(32, 7),
    keyVersion: KeyVersionSchema.parse('v1'),
    installId: 'install-integration',
    appVersion: VersionStringSchema.parse('1.0.0'),
    policyVersion: 0,
    ingestedAtMs: Date.now(),
  }
}

function eventNames(events: readonly { event: { event: { name: string } } }[]): string[] {
  return events.map((item) => item.event.event.name)
}

function counterDeltasOf(aggregates: ReturnType<typeof createRecordingSinks>['aggregates']): Map<string, number> {
  const deltas = new Map<string, number>()
  for (const item of aggregates) {
    if (item.increment.kind !== 'counter') continue
    deltas.set(item.increment.metric, (deltas.get(item.increment.metric) ?? 0) + item.increment.delta)
  }
  return deltas
}

describe('analytics message-turn integration', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    runRegistry.clear()
  })

  afterEach(() => {
    runRegistry.clear()
  })

  test('two coalesced messages produce two accepted events, one turn, and one reply with no raw ids', async () => {
    addUser({ userId: USER_ID, platformInstanceId: TEST_PLATFORM_ID, addedBy: ADMIN_ID })
    const recording = createRecordingSinks()
    const health = createRecordingHealth()
    const normalizerEnv = createIntegrationNormalizerEnv()
    const observer = createAnalyticsObserver({
      decide: decideAlwaysPseudonymous,
      normalizerEnv: () => normalizerEnv,
      health,
      log: { warn: () => {} },
      sinks: recording.sinks,
    })
    const registry = createTurnContextRegistry()

    let turnCalls = 0
    const deps: BotDeps = {
      processMessage: async (reply: ReplyFn): Promise<void> => {
        turnCalls += 1
        await reply.text('integration reply')
      },
      analyticsObserver: observer,
      analyticsTurnRegistry: registry,
    }
    const { provider: mockChat, getMessageHandler } = createMockChatForBot()
    setupBot(mockChat, ADMIN_ID, deps)
    const messageHandler = getMessageHandler()
    assert.ok(messageHandler !== null)

    await messageHandler({ ...createDmMessage(USER_ID), text: 'first half' }, createMockReply().reply)
    await messageHandler({ ...createDmMessage(USER_ID), text: 'second half' }, createMockReply().reply)
    await waitFor(() => turnCalls === 1, 5000)
    await observer.flush()

    const names = eventNames(recording.events)
    expect(names.filter((name) => name === 'chat_message_accepted')).toHaveLength(2)
    expect(names.filter((name) => name === 'auth_checked')).toHaveLength(2)
    expect(names.filter((name) => name === 'turn_started')).toHaveLength(1)
    expect(names.filter((name) => name === 'turn_completed')).toHaveLength(1)
    expect(names.filter((name) => name === 'reply_sent')).toHaveLength(1)

    const turnStarted = recording.events.find((item) => item.event.event.name === 'turn_started')
    assert.ok(turnStarted !== undefined)
    const turnStartedProps: Record<string, unknown> = turnStarted.event.props
    expect(turnStartedProps['incoming_message_count']).toBe('2')

    const counterDeltas = counterDeltasOf(recording.aggregates)
    expect(counterDeltas.get('message_accepted')).toBe(2)
    expect(counterDeltas.get('auth_granted')).toBe(2)
    expect(counterDeltas.get('turn_started')).toBe(1)
    expect(counterDeltas.get('turn_completed')).toBe(1)

    const storedJson = JSON.stringify({ events: recording.events, aggregates: recording.aggregates })
    expect(storedJson).not.toContain(USER_ID)
    expect(storedJson).not.toContain(TEST_PLATFORM_ID)
    expect(health.counts.observer_failure).toBe(0)
  })
})
