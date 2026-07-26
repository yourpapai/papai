// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AnalyticsEventV1 } from '../../src/analytics/contracts.js'
import { AnalyticsEventV1Schema } from '../../src/analytics/contracts.js'
import type { EventNameV1 } from '../../src/analytics/controlled-types.js'
import { KeyVersionSchema } from '../../src/analytics/controlled-types.js'
import { insertEligibleCanonicalEvent } from '../../src/analytics/governance/collection-serialization.js'
import { deriveCollectionRefKey, setEligibilityState } from '../../src/analytics/governance/collection-store.js'
import type { CollectionEligibilityRef } from '../../src/analytics/governance/eligibility.js'
import { openEpoch } from '../../src/analytics/storage/epoch-store.js'
import { setupTestDb } from '../utils/test-helpers.js'

export const DERIVE_KEY = Buffer.alloc(32, 7)
export const DERIVE_KEY_VERSION = KeyVersionSchema.parse('v1')
export const DERIVE_EPOCH = 'epoch-derive-1'
export const T0 = Date.UTC(2026, 0, 1, 0, 0, 0)

export type TestDb = Awaited<ReturnType<typeof setupTestDb>>

export const setupDeriveDb = async (): Promise<TestDb> => {
  const db = await setupTestDb()
  openEpoch({ epochId: DERIVE_EPOCH, startedAtMs: T0 }, { getDrizzleDb: () => db })
  return db
}

export const allowActor = (db: TestDb, platformUserId: string, nowMs: number = T0): CollectionEligibilityRef => {
  const refKey = deriveCollectionRefKey({
    key: DERIVE_KEY,
    keyVersion: DERIVE_KEY_VERSION,
    platformInstanceId: 'pi-1',
    platformUserId,
  })
  const { generation } = setEligibilityState(
    { refKey, keyVersion: DERIVE_KEY_VERSION, state: 'allow', policyVersion: 3, nowMs },
    { getDrizzleDb: () => db },
  )
  return { refKey, keyVersion: DERIVE_KEY_VERSION, generation }
}

export const denyActor = (db: TestDb, ref: CollectionEligibilityRef, nowMs: number): void => {
  setEligibilityState(
    { refKey: ref.refKey, keyVersion: ref.keyVersion, state: 'deny', policyVersion: 3, nowMs },
    { getDrizzleDb: () => db },
  )
}

export type SeedEventInput = Readonly<{
  id: string
  name: EventNameV1
  occurredAtMs: number
  actorKey?: string | null
  actorRole?: 'admin' | 'member' | 'guest' | 'system'
  contextKey?: string | null
  threadKey?: string | null
  turnKey?: string | null
  invocationMode?: 'normal' | 'command' | 'settings' | 'proactive' | 'scheduler'
  platform?: 'telegram' | 'mattermost' | 'discord' | 'kontur-talk'
  props: Record<string, unknown>
}>

export const seedEvent = (db: TestDb, ref: CollectionEligibilityRef, input: SeedEventInput): string => {
  const event: AnalyticsEventV1 = AnalyticsEventV1Schema.parse({
    schema: { name: 'papai.analytics.event', version: 1 },
    event: {
      id: input.id,
      name: input.name,
      version: 1,
      occurred_at_ms: input.occurredAtMs,
      ingested_at_ms: input.occurredAtMs + 1,
      source: 'live',
      attribution_quality: 'native',
    },
    app: { version: '6.10.0', deployment_key: 'v1.p-deploy' },
    identity: {
      key_version: DERIVE_KEY_VERSION,
      platform: input.platform ?? 'telegram',
      platform_instance_key: 'v1.p-instance',
      actor_key: input.actorKey === undefined ? 'v1.p-actor' : input.actorKey,
      context_key: input.contextKey === undefined ? 'v1.p-context' : input.contextKey,
      thread_key: input.threadKey ?? null,
      task_instance_key: null,
    },
    context: {
      context_type: 'dm',
      actor_role: input.actorRole ?? 'member',
      task_provider: 'none',
      invocation_mode: input.invocationMode ?? 'normal',
    },
    correlation: { conversation_key: null, turn_key: input.turnKey ?? null, session_key: null },
    governance: {
      purpose: 'product_analytics',
      collection_tier: 'pseudonymous',
      policy_version: 3,
      eligibility: 'allowed',
    },
    privacy: { max_class: 'C2' },
    props: input.props,
  })
  const result = insertEligibleCanonicalEvent(
    { event, processEpochId: DERIVE_EPOCH, collectionRef: ref },
    { getDrizzleDb: () => db },
  )
  if (result.status !== 'inserted') throw new Error(`expected inserted, got ${result.status}`)
  return result.eventId
}

export const TURN_STARTED_PROPS = { incoming_message_count: '1', attachment_count: '0', queue_wait_ms: 0 } as const

export const turnCompletedProps = (durationMs: number, clarification = false): Record<string, unknown> => ({
  outcome: 'ok',
  duration_ms: durationMs,
  step_count: 1,
  tool_call_count: 1,
  reply_count: '1',
  finish_reason: 'stop',
  clarification,
  live_status_used: false,
})

export const toolCompletedProps = (executionOutcome: string): Record<string, unknown> => ({
  tool_slug: 'core_task_create',
  tool_key: 'v1.p-tool',
  origin: 'core',
  domain: 'task',
  risk: 'write',
  model_role: 'main',
  args_bytes: '1_256',
  duration_ms: 40,
  execution_outcome: executionOutcome,
  result_bytes: '1_256',
  error_class: null,
  status_class: '2xx',
  retryable: null,
  recovered_same_turn: false,
})

export const intentProps = (goals: readonly string[], primary = 'I01'): Record<string, unknown> => ({
  taxonomy: 'intent.v1',
  primary,
  goals,
  confidence: 'ge_095',
  strategy: 'hybrid_v1',
  abstained: false,
})
