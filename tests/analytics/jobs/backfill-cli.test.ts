// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { ANALYTICS_HMAC_KEYRING_ENV } from '../../../src/analytics/config.js'
import { runBackfillCli } from '../../../src/analytics/jobs/backfill-cli.js'
import type { BackfillCliArgs, BackfillCliDeps } from '../../../src/analytics/jobs/backfill-cli.js'
import type { LlmUsageEventRow } from '../../../src/db/llm-usage-events-schema.js'
import * as schema from '../../../src/db/schema.js'
import type { AnalyticsPolicyRow } from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEY = Buffer.alloc(32, 9)
const BASE_MS = 1_700_000_000_000

const llmRow = (over: Partial<LlmUsageEventRow>): LlmUsageEventRow => ({
  eventId: 'llm-cli-0',
  occurredAt: BASE_MS,
  turnId: 'turn-1',
  storageContextId: 'sc-1',
  contextType: 'dm',
  chatUserId: 'user-1',
  model: 'model-x',
  modelRole: 'main',
  inputTokens: 10,
  outputTokens: 20,
  stepCount: 1,
  toolCallCount: 0,
  messageCount: 1,
  finishReason: 'stop',
  durationMs: 100,
  responseId: null,
  error: null,
  forwardedAt: null,
  forwardAttempts: 0,
  forwardError: null,
  ...over,
})

const cliArgs = (over?: Partial<BackfillCliArgs>): BackfillCliArgs => ({
  dryRun: false,
  batchSize: 100,
  resume: false,
  source: 'all',
  reconcile: false,
  ...over,
})

const policyRow = (over?: Partial<AnalyticsPolicyRow>): AnalyticsPolicyRow => ({
  singletonId: 1,
  localMode: 'local_aggregate',
  externalAggregateEnabled: false,
  externalPseudonymousEnabled: false,
  policyVersion: 1,
  noticeVersion: 1,
  controllerContact: 'ops@example.com',
  purpose: 'usage analytics',
  lawfulBasisMode: 'legitimate_interest',
  retainedEventHorizonDays: 30,
  subjectRightsLookupHorizonDays: 90,
  reviewDateMs: BASE_MS,
  acknowledgedAtMs: BASE_MS,
  policyEffectiveAtMs: BASE_MS,
  configVersion: 1,
  updatedAtMs: BASE_MS,
  ...over,
})

const cliDeps = (db: Db, getPolicy: () => AnalyticsPolicyRow): BackfillCliDeps => ({
  getDrizzleDb: (): Db => db,
  env: { [ANALYTICS_HMAC_KEYRING_ENV]: `v1:${KEY.toString('hex')}` },
  nowMs: BASE_MS + 86_400_000,
  getPolicy,
})

const appliedRows = (db: Db): number =>
  db.select().from(schema.analyticsBackfillAggregateContributions).all().length +
  db.select().from(schema.analyticsBackfillEventMap).all().length +
  db.select().from(schema.analyticsBackfillRuns).all().length

describe('backfill CLI cutoff gate', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    db.insert(schema.llmUsageEvents).values(llmRow({})).run()
  })

  test('policy read failure refuses closed with a bounded reason and applies zero rows', () => {
    const result = runBackfillCli(
      cliArgs(),
      cliDeps(db, () => {
        throw new Error('policy store unavailable')
      }),
    )
    expect(result).toEqual({
      exitCode: 1,
      error: true,
      lines: ['status=error reason=approval_unavailable'],
    })
    expect(appliedRows(db)).toBe(0)
  })

  test('legitimate_interest mode without explicit approval refuses and applies zero rows', () => {
    const result = runBackfillCli(
      cliArgs(),
      cliDeps(db, () => policyRow({ lawfulBasisMode: 'legitimate_interest' })),
    )
    expect(result).toEqual({
      exitCode: 1,
      error: true,
      lines: ['status=error reason=approval_required'],
    })
    expect(appliedRows(db)).toBe(0)
  })
})
