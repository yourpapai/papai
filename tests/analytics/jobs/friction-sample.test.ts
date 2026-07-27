// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import {
  destroyTokenMap,
  sampleFrictionSessions,
  writeFrictionSampleOutputs,
} from '../../../src/analytics/jobs/friction-sample.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { insertFixtureEvent, NOW, SOURCE_GEN } from '../rekey/fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const DAY = 86_400_000
const SESSION_START = NOW - 2 * DAY

let workDir = ''

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'papai-friction-test-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

const FRICTION_BITS = {
  rephrase: 0,
  clarification_abandoned: 0,
  permission_issue: 0,
  stop: 0,
  long_turn: 0,
  disclosure_fallback: 0,
  failure_chain: 0,
} as const

const seedSession = (
  db: Db,
  input: {
    index: number
    turnCount: number
    platform?: string
    contextType?: string
    appVersion?: string
    frictionBits?: Partial<Record<keyof typeof FRICTION_BITS, number>>
    endMs?: number
    mature?: boolean
  },
): void => {
  const i = input.index
  const endMs = input.endMs ?? SESSION_START + 1000
  const eventId = `ev-t${i}`
  insertFixtureEvent(db, {
    eventId,
    generation: SOURCE_GEN,
    sourceRefKey: `src-t${i}`,
    eventName: 'turn_completed',
    occurredAtMs: endMs,
    actorKey: `v1.p-actor-${i}`,
    conversationKey: `v1.p-conversation-${i}`,
    turnKey: `v1.p-turn-${i}`,
    sessionKey: `v1.p-session-${i}`,
    platformInstanceKey: 'v1.p-platform',
    propsJson: JSON.stringify({ duration_ms: 500, content: 'RAW-CONTENT-MUST-NOT-LEAK' }),
  })
  db.$client.run(`UPDATE analytics_events SET platform = ?, context_type = ?, app_version = ? WHERE event_id = ?`, [
    input.platform ?? 'telegram',
    input.contextType ?? 'dm',
    input.appVersion ?? '6.10.0',
    eventId,
  ])
  db.$client.run(
    `INSERT INTO analytics_sessions (
       session_key, storage_generation, actor_key, conversation_key, start_ms, end_ms,
       duration_ms, activity_count, turn_count, first_event_id, last_event_id, sessionization_version
     ) VALUES (?, 'gen-1', ?, ?, ?, ?, 1000, 1, ?, ?, ?, 1)`,
    [
      `v1.p-session-${i}`,
      `v1.p-actor-${i}`,
      `v1.p-conversation-${i}`,
      SESSION_START,
      endMs,
      input.turnCount,
      eventId,
      eventId,
    ],
  )
  db.$client.run(
    `INSERT INTO analytics_session_events (session_key, event_id, occurred_at_ms, extends_session, sessionization_version)
     VALUES (?, ?, ?, 0, 1)`,
    [`v1.p-session-${i}`, eventId, endMs],
  )
  const bits = { ...FRICTION_BITS, ...input.frictionBits }
  const componentCount = Object.values(bits).reduce((sum, bit) => sum + bit, 0)
  db.$client.run(
    `INSERT INTO analytics_turn_friction (
       turn_key, storage_generation, actor_key, conversation_key, occurred_at_ms,
       rephrase, clarification_abandoned, permission_issue, stop, long_turn, disclosure_fallback,
       failure_chain, component_count, display_score, anchor_event_id, friction_version
     ) VALUES (?, 'gen-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1)`,
    [
      `v1.p-turn-${i}`,
      `v1.p-actor-${i}`,
      `v1.p-conversation-${i}`,
      endMs,
      bits.rephrase,
      bits.clarification_abandoned,
      bits.permission_issue,
      bits.stop,
      bits.long_turn,
      bits.disclosure_fallback,
      bits.failure_chain,
      componentCount,
      eventId,
    ],
  )
}

const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

describe('friction sampling stratification', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    db.$client.run(
      `INSERT INTO analytics_process_epochs (epoch_id, state, started_at_ms) VALUES ('epoch-1', 'open', 0)`,
    )
  })

  test('partitions mature sessions into turn-count deciles', () => {
    for (let i = 1; i <= 10; i += 1) seedSession(db, { index: i, turnCount: i })
    const result = sampleFrictionSessions({ nowMs: NOW, perStratum: 5, seed: 'test-seed' }, depsOf(db))
    const deciles = result.cases.map((c) => c.turnCountDecile).sort((a, b) => a - b)
    expect(deciles).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  test('partitions by platform, context type, app version, and signature band 0_1|2_3|4_7', () => {
    seedSession(db, { index: 1, turnCount: 2 })
    seedSession(db, { index: 2, turnCount: 2, platform: 'discord', frictionBits: { rephrase: 1, stop: 1 } })
    seedSession(db, {
      index: 3,
      turnCount: 2,
      contextType: 'group',
      frictionBits: { rephrase: 1, stop: 1, long_turn: 1 },
    })
    seedSession(db, {
      index: 4,
      turnCount: 2,
      appVersion: '6.11.0',
      frictionBits: { rephrase: 1, clarification_abandoned: 1, permission_issue: 1, long_turn: 1 },
    })
    const result = sampleFrictionSessions({ nowMs: NOW, perStratum: 5, seed: 'test-seed' }, depsOf(db))
    expect(result.cases).toHaveLength(4)
    for (const sample of result.cases) {
      expect(sample.caseToken).toMatch(/^case-[a-z0-9-]+$/u)
    }
    const bands = new Set(result.cases.map((c) => c.signatureBand))
    expect(bands).toEqual(new Set(['0_1', '2_3', '4_7']))
    const discord = result.cases.find((c) => c.platform === 'discord')
    expect(discord?.signatureBand).toBe('2_3')
    const grouped = result.cases.find((c) => c.contextType === 'group')
    expect(grouped?.signatureBand).toBe('2_3')
    const upgraded = result.cases.find((c) => c.appVersion === '6.11.0')
    expect(upgraded?.signatureBand).toBe('4_7')
    expect(upgraded?.signatureCount).toBe(4)
  })

  test('samples a fixed number per stratum deterministically for a seed', () => {
    for (let i = 1; i <= 6; i += 1) seedSession(db, { index: i, turnCount: 2 })
    const first = sampleFrictionSessions({ nowMs: NOW, perStratum: 2, seed: 'seed-a' }, depsOf(db))
    const second = sampleFrictionSessions({ nowMs: NOW, perStratum: 2, seed: 'seed-a' }, depsOf(db))
    expect(first.cases).toHaveLength(2)
    expect(Object.values(first.tokenMap).sort()).toEqual(Object.values(second.tokenMap).sort())
    const third = sampleFrictionSessions({ nowMs: NOW, perStratum: 6, seed: 'seed-a' }, depsOf(db))
    expect(third.cases).toHaveLength(6)
  })

  test('immature sessions are never sampled', () => {
    seedSession(db, { index: 1, turnCount: 2 })
    seedSession(db, { index: 2, turnCount: 2, platform: 'discord', endMs: NOW - 1000 })
    const result = sampleFrictionSessions({ nowMs: NOW, perStratum: 5, seed: 'seed-a' }, depsOf(db))
    expect(Object.values(result.tokenMap)).toEqual(['v1.p-session-1'])
  })

  test('timelines are typed and product output contains no actor or session key', () => {
    seedSession(db, { index: 1, turnCount: 2 })
    const result = sampleFrictionSessions({ nowMs: NOW, perStratum: 5, seed: 'seed-a' }, depsOf(db))
    const sample = result.cases[0]
    expect(sample).toBeDefined()
    expect(sample?.timeline[0]).toEqual({ eventName: 'turn_completed', offsetMs: 1000 })
    const serialized = JSON.stringify(result.cases)
    expect(serialized).not.toContain('v1.p-session')
    expect(serialized).not.toContain('v1.p-actor')
    expect(serialized).not.toContain('RAW-CONTENT-MUST-NOT-LEAK')

    const outputPath = join(workDir, 'friction-sample.json')
    const tokenMapPath = join(workDir, 'friction-token-map.json')
    writeFrictionSampleOutputs(result, { outputPath, tokenMapPath })
    const productOutput = readFileSync(outputPath, 'utf8')
    expect(productOutput).not.toContain('v1.p-session')
    expect(productOutput).not.toContain('v1.p-actor')
    expect((statSync(tokenMapPath).mode & 0o777).toString(8)).toBe('600')
    const tokenMap = z.record(z.string(), z.string()).parse(JSON.parse(readFileSync(tokenMapPath, 'utf8')))
    expect(Object.values(tokenMap)).toEqual(['v1.p-session-1'])
    destroyTokenMap(tokenMapPath)
    expect(existsSync(tokenMapPath)).toBe(false)
  })
})
