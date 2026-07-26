// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { AnalyticsEventV1 } from '../../src/analytics/contracts.js'
import { AnalyticsEventV1Schema } from '../../src/analytics/contracts.js'
import { IntentV1Schema, KeyVersionSchema, PseudonymSchema } from '../../src/analytics/controlled-types.js'
import { insertEligibleCanonicalEvent } from '../../src/analytics/governance/collection-serialization.js'
import { deriveCollectionRefKey, setEligibilityState } from '../../src/analytics/governance/collection-store.js'
import type { CollectionEligibilityRef } from '../../src/analytics/governance/eligibility.js'
import { classifyHybrid } from '../../src/analytics/intent/classifier.js'
import { runIntentDerivation } from '../../src/analytics/jobs/intent.js'
import { createRephraseHandoff } from '../../src/analytics/rephrase/handoff.js'
import { openEpoch } from '../../src/analytics/storage/epoch-store.js'
import * as schema from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEY = Buffer.alloc(32, 7)
const EPOCH_ID = 'epoch-audit-1'
const NOW = 1_700_000_000_000
const CANARY = 'CANARY-audit-5c91f4-willow-quasar'

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

const turnCompletedEvent = (): AnalyticsEventV1 =>
  AnalyticsEventV1Schema.parse({
    schema: { name: 'papai.analytics.event', version: 1 },
    event: {
      id: 'v1.p-audit-turn',
      name: 'turn_completed',
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
    context: { context_type: 'dm', actor_role: 'member', task_provider: 'none', invocation_mode: 'normal' },
    correlation: { conversation_key: 'v1.p-conversation', turn_key: 'v1.p-turn-audit', session_key: null },
    governance: {
      purpose: 'product_analytics',
      collection_tier: 'pseudonymous',
      policy_version: 3,
      eligibility: 'allowed',
    },
    privacy: { max_class: 'C2' },
    props: {
      outcome: 'ok',
      duration_ms: 800,
      step_count: 1,
      tool_call_count: 0,
      reply_count: '1',
      finish_reason: 'stop',
      clarification: false,
      live_status_used: false,
    },
  })

const listTypeScriptFiles = (rootDir: string): readonly string[] => {
  const files: string[] = []
  const stack = [rootDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (dir === undefined) break
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.name.endsWith('.ts')) {
        files.push(full)
      }
    }
  }
  return files
}

const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/gu

const importSpecifiersOf = (file: string): readonly string[] =>
  [...readFileSync(file, 'utf8').matchAll(IMPORT_PATTERN)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined)

describe('intent persistence audit', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    openEpoch({ epochId: EPOCH_ID, startedAtMs: NOW }, { getDrizzleDb: () => db })
  })

  test('no canary text survives the capture or derivation path', () => {
    const { handoff, inspect } = createRephraseHandoff({ nowMs: () => NOW })
    handoff.captureText({
      actorKey: PseudonymSchema.parse('v1.p-actor'),
      conversationKey: PseudonymSchema.parse('v1.p-conversation'),
      turnKey: PseudonymSchema.parse('v1.p-turn-audit'),
      capturedAtMs: NOW,
      text: `please ${CANARY} create a task`,
    })
    expect(JSON.stringify(inspect())).not.toContain(CANARY)

    const ref = allowRef(db)
    insertEligibleCanonicalEvent(
      { event: turnCompletedEvent(), processEpochId: EPOCH_ID, collectionRef: ref },
      { getDrizzleDb: () => db },
    )
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
    const rows = db.select().from(schema.analyticsEvents).all()
    expect(rows.length).toBeGreaterThan(1)
    expect(JSON.stringify(rows)).not.toContain(CANARY)
  })

  test('every stored intent_classified row satisfies the governed contract shape', () => {
    const ref = allowRef(db)
    insertEligibleCanonicalEvent(
      { event: turnCompletedEvent(), processEpochId: EPOCH_ID, collectionRef: ref },
      { getDrizzleDb: () => db },
    )
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
    const rows = db
      .select()
      .from(schema.analyticsEvents)
      .where(eq(schema.analyticsEvents.eventName, 'intent_classified'))
      .all()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    assert.ok(row !== undefined)
    expect(row.maxClass).toBe('C2')
    expect(row.eventVersion).toBe(1)
    expect(row.schemaVersion).toBe(1)
    const props = z.record(z.string(), z.unknown()).parse(JSON.parse(row.propsJson))
    expect(props['taxonomy']).toBe('intent.v1')
    expect(IntentV1Schema.safeParse(props['primary']).success).toBe(true)
    expect(['lt_050', '050_069', '070_084', '085_094', 'ge_095']).toContain(String(props['confidence']))
    expect(props['strategy']).toBe('hybrid_v1')
    expect(typeof props['abstained']).toBe('boolean')
  })

  test('no runtime analytics module imports the frozen PoC or a small model', () => {
    const analyticsDir = path.resolve(import.meta.dir, '../../src/analytics')
    const files = listTypeScriptFiles(analyticsDir)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      for (const specifier of importSpecifiersOf(file)) {
        expect(specifier).not.toContain('docs/research')
        expect(specifier).not.toContain('poc/intent')
        expect(specifier).not.toContain('small-model')
      }
    }
  })

  test('the deterministic classifier stays within a generous latency budget', () => {
    const started = performance.now()
    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      classifyHybrid({
        tool_trace: [{ tool_slug: 'create_task' }, { tool_slug: 'find_tasks' }],
        feature_events: [],
        command_family: 'none',
      })
    }
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  test('rephrase captureText is bounded and its dependency surface has no SQLite or network', () => {
    const captureSurface = [
      path.resolve(import.meta.dir, '../../src/analytics/rephrase/handoff.ts'),
      path.resolve(import.meta.dir, '../../src/analytics/rephrase/state.ts'),
      path.resolve(import.meta.dir, '../../src/analytics/rephrase/matching.ts'),
      path.resolve(import.meta.dir, '../../src/analytics/intent/rephrase.ts'),
    ]
    for (const file of captureSurface) {
      for (const specifier of importSpecifiersOf(file)) {
        expect(specifier).not.toContain('db')
        expect(specifier).not.toContain('drizzle')
        expect(specifier).not.toContain('undici')
        expect(specifier.startsWith('node:')).toBe(false)
      }
    }

    const actorKey = PseudonymSchema.parse('v1.p-actor')
    const conversationKey = PseudonymSchema.parse('v1.p-conversation')
    const turnKeys = Array.from({ length: 10_000 }, (_, index) => PseudonymSchema.parse(`v1.p-turn-${index}`))
    const { handoff } = createRephraseHandoff({ nowMs: () => NOW })
    const started = performance.now()
    for (const turnKey of turnKeys) {
      handoff.captureText({
        actorKey,
        conversationKey,
        turnKey,
        capturedAtMs: NOW,
        text: 'please create a task for the release',
      })
    }
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})
