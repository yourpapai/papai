// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { eq } from 'drizzle-orm'

import { ANALYTICS_HMAC_KEYRING_ENV } from '../../src/analytics/config.js'
import type { AnalyticsSourceContext, ChatMessageAcceptedFact } from '../../src/analytics/source-facts.js'
import { getActiveAnalyticsRuntime, startAnalytics, stopAnalytics } from '../../src/analytics/start-analytics.js'
import { getOpenEpoch } from '../../src/analytics/storage/epoch-store.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import * as schema from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const memberSource: AnalyticsSourceContext = {
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-42',
  nativeContextId: 'user-42',
  storageContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  configContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-raw-1',
}

const messageFact = (ordinal: number, baseMs: number): ChatMessageAcceptedFact => ({
  version: 1,
  type: 'chat_message_accepted',
  sourceEventId: `se-overflow-${ordinal}`,
  occurredAtMs: baseMs + ordinal,
  source: memberSource,
  inputCount: 1,
  inputLengthChars: 200,
  attachmentCount: 0,
  isCommand: false,
  command: 'none',
})

const restoreKeyringEnv = (saved: string | undefined): void => {
  if (saved === undefined) {
    Reflect.deleteProperty(process.env, ANALYTICS_HMAC_KEYRING_ENV)
    return
  }
  process.env[ANALYTICS_HMAC_KEYRING_ENV] = saved
}

describe('start-analytics', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('stop without start is an idempotent no-op', async () => {
    await expect(stopAnalytics()).resolves.toBeUndefined()
    expect(typeof startAnalytics).toBe('function')
  })

  test('the live observer records the epoch-bound controlled overflow row on a full queue', async () => {
    mockLogger()
    db.update(schema.analyticsPolicy).set({ localMode: 'local_aggregate' }).run()
    const previousKeyring = process.env[ANALYTICS_HMAC_KEYRING_ENV]
    process.env[ANALYTICS_HMAC_KEYRING_ENV] = `v1:${'ab'.repeat(32)}`
    try {
      startAnalytics()
      const active = getActiveAnalyticsRuntime()
      assert(active !== null)
      const open = getOpenEpoch({ getDrizzleDb: () => db })
      assert(open !== null)
      const baseMs = Date.now() - 5000
      for (let ordinal = 0; ordinal < 1026; ordinal += 1) active.observer.observe(messageFact(ordinal, baseMs))

      const overflowRows = db
        .select()
        .from(schema.analyticsEpochSourceCounters)
        .where(eq(schema.analyticsEpochSourceCounters.disposition, 'controlled_overflow'))
        .all()
      expect(overflowRows.length).toBeGreaterThanOrEqual(1)
      for (const row of overflowRows) expect(row.epochId).toBe(open.epochId)
      expect(overflowRows.reduce((sum, row) => sum + row.value, 0)).toBe(2)
    } finally {
      restoreKeyringEnv(previousKeyring)
      await stopAnalytics()
    }
  })
})
