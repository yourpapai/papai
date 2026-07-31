// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { AnalyticsEventV1 } from '../../src/analytics/contracts.js'
import { AnalyticsEventV1Schema } from '../../src/analytics/contracts.js'
import { KeyVersionSchema } from '../../src/analytics/controlled-types.js'
import {
  deleteCanonicalEventsForRef,
  insertEligibleCanonicalEvent,
} from '../../src/analytics/governance/collection-serialization.js'
import { deriveCollectionRefKey, setEligibilityState } from '../../src/analytics/governance/collection-store.js'
import type { CollectionEligibilityRef } from '../../src/analytics/governance/eligibility.js'
import { createPseudonym } from '../../src/analytics/identity/pseudonym.js'
import { runIntentDerivation } from '../../src/analytics/jobs/intent.js'
import { openEpoch } from '../../src/analytics/storage/epoch-store.js'
import * as schema from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEY = Buffer.alloc(32, 7)
const EPOCH_ID = 'epoch-derivation-1'
const NOW = 1_700_000_000_000

const allowRef = (db: Db): CollectionEligibilityRef => {
  const refKey = deriveCollectionRefKey({
    key: KEY,
    keyVersion: 'v1',
    platformInstanceId: 'pi-1',
    platformUserId: 'user-42',
  })
  const { generation } = setEligibilityState(
    { refKey, keyVersion: 'v1', state: 'allow', policyVersion: 3, nowMs: NOW },
    { getDrizzleDb: () => db },
  )
  return { refKey, keyVersion: 'v1', generation }
}

const envelope = (
  name: 'turn_completed' | 'tool_completed',
  idSuffix: string,
  turnKey: string,
  props: Record<string, unknown>,
): AnalyticsEventV1 =>
  AnalyticsEventV1Schema.parse({
    schema: { name: 'papai.analytics.event', version: 1 },
    event: {
      id: `v1.p-${idSuffix}`,
      name,
      version: 1,
      occurred_at_ms: NOW,
      ingested_at_ms: NOW + 1,
      source: 'live',
      attribution_quality: 'native',
    },
    app: { version: '6.10.0', deployment_key: 'v1.p-deploy' },
    identity: {
      key_version: 'v1',
      platform: 'mattermost',
      platform_instance_key: 'v1.p-platform',
      actor_key: 'v1.p-actor',
      context_key: 'v1.p-context',
      thread_key: 'v1.p-thread',
      task_instance_key: 'v1.p-task-instance',
    },
    context: { context_type: 'group', actor_role: 'admin', task_provider: 'kaneo', invocation_mode: 'command' },
    correlation: { conversation_key: 'v1.p-conversation', turn_key: turnKey, session_key: 'v1.p-session' },
    governance: {
      purpose: 'product_analytics',
      collection_tier: 'pseudonymous',
      policy_version: 3,
      eligibility: 'allowed',
    },
    privacy: { max_class: 'C1' },
    props,
  })

const TURN_COMPLETED_PROPS = {
  outcome: 'ok',
  duration_ms: 900,
  step_count: 3,
  tool_call_count: 2,
  reply_count: '1',
  finish_reason: 'tool_calls',
  clarification: false,
  live_status_used: false,
} as const

const toolProps = (toolSlug: string): Record<string, unknown> => ({
  tool_slug: toolSlug,
  tool_key: 'v1.p-tool',
  origin: 'core',
  domain: 'task',
  risk: 'write',
  model_role: 'main',
  args_bytes: '1_256',
  duration_ms: 40,
  execution_outcome: 'semantic_success',
  result_bytes: '1_256',
  error_class: null,
  status_class: '2xx',
  retryable: null,
  recovered_same_turn: false,
})

const insertSource = (db: Db, ref: CollectionEligibilityRef, event: AnalyticsEventV1): void => {
  const result = insertEligibleCanonicalEvent(
    { event, processEpochId: EPOCH_ID, collectionRef: ref },
    { getDrizzleDb: () => db },
  )
  if (result.status !== 'inserted') throw new Error(`expected inserted, got ${result.status}`)
}

const intentRow = (db: Db): typeof schema.analyticsEvents.$inferSelect | undefined =>
  db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventName, 'intent_classified')).get()

const runJob = (db: Db): ReturnType<typeof runIntentDerivation> =>
  runIntentDerivation(
    {
      processEpochId: EPOCH_ID,
      key: KEY,
      keyVersion: KeyVersionSchema.parse('v1'),
      nowMs: NOW + 60_000,
      localMode: 'local_pseudonymous',
    },
    { getDrizzleDb: () => db },
  )

describe('intent derivation contract', () => {
  let db: Db
  let ref: CollectionEligibilityRef

  beforeEach(async () => {
    db = await setupTestDb()
    openEpoch({ epochId: EPOCH_ID, startedAtMs: NOW }, { getDrizzleDb: () => db })
    ref = allowRef(db)
    insertSource(db, ref, envelope('turn_completed', 'tc-1', 'v1.p-turn-1', TURN_COMPLETED_PROPS))
    insertSource(db, ref, envelope('tool_completed', 'tl-1', 'v1.p-turn-1', toolProps('create_task')))
    insertSource(db, ref, envelope('tool_completed', 'tl-2', 'v1.p-turn-1', toolProps('find_tasks')))
  })

  test('the derived envelope inherits identity, context, app, correlation, and policy from the source turn', () => {
    runJob(db)
    const row = intentRow(db)
    expect(row?.appVersion).toBe('6.10.0')
    expect(row?.deploymentKey).toBe('v1.p-deploy')
    expect(row?.platform).toBe('mattermost')
    expect(row?.platformInstanceKey).toBe('v1.p-platform')
    expect(row?.actorKey).toBe('v1.p-actor')
    expect(row?.contextKey).toBe('v1.p-context')
    expect(row?.threadKey).toBe('v1.p-thread')
    expect(row?.taskInstanceKey).toBe('v1.p-task-instance')
    expect(row?.contextType).toBe('group')
    expect(row?.actorRole).toBe('admin')
    expect(row?.taskProvider).toBe('kaneo')
    expect(row?.invocationMode).toBe('command')
    expect(row?.conversationKey).toBe('v1.p-conversation')
    expect(row?.turnKey).toBe('v1.p-turn-1')
    expect(row?.sessionKey).toBe('v1.p-session')
    expect(row?.policyVersion).toBe(3)
    expect(row?.eligibility).toBe('allowed')
    expect(row?.maxClass).toBe('C2')
    expect(row?.occurredAtMs).toBe(NOW)
  })

  test('the derived event id is the deterministic intent-output pseudonym of the turn', () => {
    runJob(db)
    const row = intentRow(db)
    const expectedId = createPseudonym({
      key: KEY,
      keyVersion: 'v1',
      domain: 'intent-output:v1',
      components: ['v1.p-turn-1', 'intent.v1'],
    })
    expect(row?.sourceRefKey).toBe(expectedId)
  })

  test('goals only ever contain core component ids', () => {
    runJob(db)
    const row = intentRow(db)
    assert.ok(row !== undefined)
    const props = z.record(z.string(), z.unknown()).parse(JSON.parse(row.propsJson))
    const goals = z.array(z.string()).parse(props['goals'])
    expect(goals.length).toBeGreaterThan(0)
    for (const goal of goals) {
      expect(['I21', 'I22', 'I23']).not.toContain(goal)
    }
  })

  test('withdrawal through the inherited ref removes the derived event with the source', () => {
    runJob(db)
    expect(intentRow(db)).toBeDefined()
    const deleted = deleteCanonicalEventsForRef({ refKey: ref.refKey }, { getDrizzleDb: () => db })
    expect(deleted.deletedEventIds).toHaveLength(4)
    expect(intentRow(db)).toBeUndefined()
  })

  test('the stored row contains no raw message or tool payload text', () => {
    runJob(db)
    const row = intentRow(db)
    assert.ok(row !== undefined)
    const rowJson = JSON.stringify(row)
    expect(rowJson).not.toContain('lighthouse')
    expect(rowJson).not.toContain('user-42')
    expect(rowJson).not.toContain(ref.refKey)
  })
})
