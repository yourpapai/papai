// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { AnalyticsEventV1 } from '../../../src/analytics/contracts.js'
import { AnalyticsEventV1Schema } from '../../../src/analytics/contracts.js'
import { KeyVersionSchema } from '../../../src/analytics/controlled-types.js'
import { insertEligibleCanonicalEvent } from '../../../src/analytics/governance/collection-serialization.js'
import { deriveCollectionRefKey, setEligibilityState } from '../../../src/analytics/governance/collection-store.js'
import type { CollectionEligibilityRef } from '../../../src/analytics/governance/eligibility.js'
import { runIntentDerivation } from '../../../src/analytics/jobs/intent.js'
import { openEpoch } from '../../../src/analytics/storage/epoch-store.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEY = Buffer.alloc(32, 7)
const EPOCH_ID = 'epoch-intent-1'
const NOW = 1_700_000_000_000

const allowRef = (db: Db, keyVersion: string): CollectionEligibilityRef => {
  const refKey = deriveCollectionRefKey({ key: KEY, keyVersion, platformInstanceId: 'pi-1', platformUserId: 'user-42' })
  const { generation } = setEligibilityState(
    { refKey, keyVersion, state: 'allow', policyVersion: 3, nowMs: NOW },
    { getDrizzleDb: () => db },
  )
  return { refKey, keyVersion, generation }
}

const envelope = (
  name: 'turn_completed' | 'tool_completed' | 'turn_stop_requested',
  idSuffix: string,
  turnKey: string,
  props: Record<string, unknown>,
  actorRole: 'member' | 'guest' = 'member',
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
      platform: 'telegram',
      platform_instance_key: 'v1.p-platform',
      actor_key: 'v1.p-actor',
      context_key: 'v1.p-context',
      thread_key: null,
      task_instance_key: null,
    },
    context: { context_type: 'dm', actor_role: actorRole, task_provider: 'none', invocation_mode: 'normal' },
    correlation: { conversation_key: 'v1.p-conversation', turn_key: turnKey, session_key: null },
    governance: {
      purpose: 'product_analytics',
      collection_tier: 'pseudonymous',
      policy_version: 3,
      eligibility: 'allowed',
    },
    privacy: { max_class: 'C2' },
    props,
  })

const TURN_COMPLETED_PROPS = {
  outcome: 'ok',
  duration_ms: 1200,
  step_count: 2,
  tool_call_count: 1,
  reply_count: '1',
  finish_reason: 'stop',
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

const insertSource = (db: Db, ref: CollectionEligibilityRef, event: AnalyticsEventV1): string => {
  const result = insertEligibleCanonicalEvent(
    { event, processEpochId: EPOCH_ID, collectionRef: ref },
    { getDrizzleDb: () => db },
  )
  if (result.status !== 'inserted') throw new Error(`expected inserted, got ${result.status}`)
  return result.eventId
}

const propsOf = (json: string): Record<string, unknown> => z.record(z.string(), z.unknown()).parse(JSON.parse(json))

const intentRows = (db: Db): readonly (typeof schema.analyticsEvents.$inferSelect)[] =>
  db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventName, 'intent_classified')).all()

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

describe('intent derivation job', () => {
  let db: Db
  let ref: CollectionEligibilityRef

  beforeEach(async () => {
    db = await setupTestDb()
    openEpoch({ epochId: EPOCH_ID, startedAtMs: NOW }, { getDrizzleDb: () => db })
    ref = allowRef(db, 'v1')
  })

  test('classifies a turn from tool evidence and inherits envelope and ref', () => {
    insertSource(db, ref, envelope('turn_completed', 'tc-1', 'v1.p-turn-1', TURN_COMPLETED_PROPS))
    insertSource(db, ref, envelope('tool_completed', 'tl-1', 'v1.p-turn-1', toolProps('create_task')))
    const result = runJob(db)
    expect(result).toEqual({
      scanned: 1,
      alreadyPresent: 0,
      inserted: 1,
      skippedNoRef: 0,
      skippedGuest: 0,
      notEligible: 0,
    })
    const rows = intentRows(db)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    assert.ok(row !== undefined)
    expect(row.turnKey).toBe('v1.p-turn-1')
    expect(row.actorKey).toBe('v1.p-actor')
    expect(row.platform).toBe('telegram')
    expect(row.policyVersion).toBe(3)
    expect(row.maxClass).toBe('C2')
    const props = propsOf(row.propsJson)
    expect(props).toEqual({
      taxonomy: 'intent.v1',
      primary: 'I01',
      goals: ['I01'],
      confidence: 'ge_095',
      strategy: 'hybrid_v1',
      abstained: false,
    })
    const associations = db
      .select()
      .from(schema.analyticsEventCollectionRefs)
      .where(eq(schema.analyticsEventCollectionRefs.eventId, row.eventId))
      .all()
    expect(associations).toHaveLength(1)
    expect(associations[0]?.refKey).toBe(ref.refKey)
  })

  test('a turn without evidence inserts an abstention', () => {
    insertSource(db, ref, envelope('turn_completed', 'tc-2', 'v1.p-turn-2', TURN_COMPLETED_PROPS))
    const result = runJob(db)
    expect(result.inserted).toBe(1)
    const abstainRows = intentRows(db)
    const abstainRow = abstainRows[0]
    assert.ok(abstainRow !== undefined)
    const abstainProps = propsOf(abstainRow.propsJson)
    expect(abstainProps['abstained']).toBe(true)
    expect(abstainProps['primary']).toBe('I22')
    expect(abstainProps['goals']).toEqual([])
  })

  test('a stop request in the same turn classifies as no_action', () => {
    insertSource(db, ref, envelope('turn_completed', 'tc-3', 'v1.p-turn-3', TURN_COMPLETED_PROPS))
    insertSource(db, ref, envelope('turn_stop_requested', 'ts-3', 'v1.p-turn-3', { stage: 'graceful' }))
    const result = runJob(db)
    expect(result.inserted).toBe(1)
    const stopRows = intentRows(db)
    const stopRow = stopRows[0]
    assert.ok(stopRow !== undefined)
    const stopProps = propsOf(stopRow.propsJson)
    expect(stopProps['primary']).toBe('I21')
    expect(stopProps['abstained']).toBe(false)
  })

  test('a second run is idempotent', () => {
    insertSource(db, ref, envelope('turn_completed', 'tc-4', 'v1.p-turn-4', TURN_COMPLETED_PROPS))
    insertSource(db, ref, envelope('tool_completed', 'tl-4', 'v1.p-turn-4', toolProps('create_task')))
    runJob(db)
    const second = runJob(db)
    expect(second).toEqual({
      scanned: 1,
      alreadyPresent: 1,
      inserted: 0,
      skippedNoRef: 0,
      skippedGuest: 0,
      notEligible: 0,
    })
    expect(intentRows(db)).toHaveLength(1)
  })

  test('guest turns are never classified', () => {
    insertSource(db, ref, envelope('turn_completed', 'tc-5', 'v1.p-turn-5', TURN_COMPLETED_PROPS, 'guest'))
    insertSource(db, ref, envelope('tool_completed', 'tl-5', 'v1.p-turn-5', toolProps('create_task'), 'guest'))
    const result = runJob(db)
    expect(result.skippedGuest).toBe(1)
    expect(result.inserted).toBe(0)
    expect(intentRows(db)).toHaveLength(0)
  })

  test('aggregate-local mode never stores intent even with an eligible turn', () => {
    insertSource(db, ref, envelope('turn_completed', 'tc-8', 'v1.p-turn-8', TURN_COMPLETED_PROPS))
    insertSource(db, ref, envelope('tool_completed', 'tl-8', 'v1.p-turn-8', toolProps('create_task')))
    const result = runIntentDerivation(
      {
        processEpochId: EPOCH_ID,
        key: KEY,
        keyVersion: KeyVersionSchema.parse('v1'),
        nowMs: NOW + 60_000,
        localMode: 'local_aggregate',
      },
      { getDrizzleDb: () => db },
    )
    expect(result).toEqual({
      scanned: 0,
      alreadyPresent: 0,
      inserted: 0,
      skippedNoRef: 0,
      skippedGuest: 0,
      notEligible: 0,
    })
    expect(intentRows(db)).toHaveLength(0)
  })

  test('non-pseudonymous modes short-circuit before resolving the database', () => {
    const probeDb = (): never => {
      throw new Error('derivation resolved the database outside local_pseudonymous mode')
    }
    for (const localMode of ['off', 'local_aggregate'] as const) {
      const result = runIntentDerivation(
        {
          processEpochId: EPOCH_ID,
          key: KEY,
          keyVersion: KeyVersionSchema.parse('v1'),
          nowMs: NOW + 60_000,
          localMode,
        },
        { getDrizzleDb: probeDb },
      )
      expect(result.scanned).toBe(0)
      expect(result.inserted).toBe(0)
    }
  })

  test('a turn without a collection ref is skipped without minting one', () => {
    const eventId = insertSource(db, ref, envelope('turn_completed', 'tc-6', 'v1.p-turn-6', TURN_COMPLETED_PROPS))
    db.delete(schema.analyticsEventCollectionRefs).where(eq(schema.analyticsEventCollectionRefs.eventId, eventId)).run()
    const result = runJob(db)
    expect(result.skippedNoRef).toBe(1)
    expect(result.inserted).toBe(0)
    expect(intentRows(db)).toHaveLength(0)
  })

  test('a deny race before the insert is reported as not eligible', () => {
    insertSource(db, ref, envelope('turn_completed', 'tc-7', 'v1.p-turn-7', TURN_COMPLETED_PROPS))
    setEligibilityState(
      { refKey: ref.refKey, keyVersion: ref.keyVersion, state: 'deny', policyVersion: 3, nowMs: NOW + 10 },
      { getDrizzleDb: () => db },
    )
    const result = runJob(db)
    expect(result.notEligible).toBe(1)
    expect(result.inserted).toBe(0)
    expect(intentRows(db)).toHaveLength(0)
  })
})
