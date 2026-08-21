// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { z } from 'zod'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { llmUsageEvents } from '../../../src/db/schema.js'
import { clearStatsCacheForTesting } from '../../../src/stats/index.testing.js'
import { scenario } from '../harness/scenario.js'

const GlobalUsageBody = z.object({ llmUsage: z.object({ totalCalls: z.number() }) })

type SeedUsageRow = {
  eventId: string
  occurredAt: number
  storageContextId: string
  contextType: 'dm'
  chatUserId: string
  model: string
  modelRole: string
  inputTokens: number
  outputTokens: number
  stepCount: number
  toolCallCount: number
  messageCount: number
  durationMs: number
}

let seedSequence = 0

function seedUsage(storageContextId: string, chatUserId: string, occurredAt: number): SeedUsageRow {
  seedSequence += 1
  return {
    eventId: `seed-stats-${seedSequence}-${storageContextId}`,
    occurredAt,
    storageContextId,
    contextType: 'dm',
    chatUserId,
    model: 'scenario-stats-model',
    modelRole: 'main',
    inputTokens: 100,
    outputTokens: 200,
    stepCount: 1,
    toolCallCount: 0,
    messageCount: 1,
    durationMs: 500,
  }
}

scenario('SCN-stats-anonymity: stats responses omit raw subject identity', async ({ given, when, then, world }) => {
  try {
    const privateUser = given.user('stats-private-subject')
    const privateUsername = 'private-username-leakcheck'
    world.fixtures.authorizeUser({ userId: privateUser.id, username: privateUsername })

    const dm = given.dm(privateUser)
    const storageContextId = world.scopedStorageContextId(dm)
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values(seedUsage(storageContextId, privateUser.id, Date.now()))
      .run()
    clearStatsCacheForTesting()

    const session = await given.dashboardSession()
    const response = await when.dashboardRequest(session, `/stats/subject/${encodeURIComponent(storageContextId)}`)
    then.responseStatus(response, 200)
    const body = await response.text()
    expect(body).not.toContain(privateUsername)
    expect(JSON.parse(body)).toMatchObject({ storageContextId, displayName: null, contextType: 'dm' })
  } finally {
    clearStatsCacheForTesting()
  }
})

scenario(
  'SCN-stats-aggregate-window: global stats respect requested aggregation windows',
  async ({ given, when, then }) => {
    try {
      const now = Date.now()
      getDrizzleDb()
        .insert(llmUsageEvents)
        .values([
          seedUsage('recent-stats', 'recent-user', now),
          seedUsage('expired-stats', 'expired-user', now - 8 * 24 * 60 * 60 * 1000),
        ])
        .run()
      clearStatsCacheForTesting()

      const session = await given.dashboardSession()
      const week = await when.dashboardRequest(session, '/stats/global?window=7d')
      const all = await when.dashboardRequest(session, '/stats/global?window=all')
      then.responseStatus(week, 200)
      then.responseStatus(all, 200)
      expect(GlobalUsageBody.parse(await week.json()).llmUsage.totalCalls).toBe(1)
      expect(GlobalUsageBody.parse(await all.json()).llmUsage.totalCalls).toBe(2)
    } finally {
      clearStatsCacheForTesting()
    }
  },
)
