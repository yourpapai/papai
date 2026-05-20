// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { clearStatsCacheForTesting, getGlobalStats } from '../../src/stats/index.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Target on a dev laptop is ~500ms. The CI/headroom budget is 1000ms.
const PERF_BUDGET_MS = 1000

const DM_SUBJECTS = 700
const GROUP_SUBJECTS = 300
const TOTAL_SUBJECTS = DM_SUBJECTS + GROUP_SUBJECTS
const MESSAGE_ROWS = 100_000
const MEMO_ROWS = 10_000
const TOOL_CALL_ROWS = 5_000

function seedFixtures(): void {
  const sqlite = getDrizzleDb().$client

  sqlite.run('BEGIN')
  try {
    const insertUser = sqlite.prepare('INSERT INTO users (platform_user_id, added_by, added_at) VALUES (?, ?, ?)')
    const insertGroup = sqlite.prepare('INSERT INTO authorized_groups (group_id, added_by, added_at) VALUES (?, ?, ?)')
    const baseAddedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
    for (let i = 0; i < DM_SUBJECTS; i++) insertUser.run(`u${i}`, 'admin', baseAddedAt)
    for (let i = 0; i < GROUP_SUBJECTS; i++) insertGroup.run(`g${i}`, 'admin', baseAddedAt)

    const insertMessage = sqlite.prepare(
      'INSERT INTO message_metadata (context_id, message_id, author_id, timestamp, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    const now = Date.now()
    for (let i = 0; i < MESSAGE_ROWS; i++) {
      const subjectIndex = i % TOTAL_SUBJECTS
      const contextId = subjectIndex < DM_SUBJECTS ? `u${subjectIndex}` : `g${subjectIndex - DM_SUBJECTS}`
      const ts = now - (i % (30 * 24 * 60 * 60 * 1000))
      insertMessage.run(contextId, `m${i}`, contextId, ts, ts + 1_000_000)
    }

    const insertMemo = sqlite.prepare(
      'INSERT INTO memos (id, user_id, content, summary, tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const memoCreatedAt = new Date().toISOString()
    for (let i = 0; i < MEMO_ROWS; i++) {
      const userId = `u${i % DM_SUBJECTS}`
      insertMemo.run(`memo${i}`, userId, 'c', null, '[]', 'active', memoCreatedAt, memoCreatedAt)
    }

    const insertTool = sqlite.prepare(
      'INSERT INTO tool_call_events (event_id, turn_id, occurred_at, storage_context_id, context_type, chat_user_id, model, model_role, tool_name, tool_call_id, success, forward_attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
    )
    const toolNames = ['create_task', 'update_task', 'search_tasks', 'list_tasks', 'web_fetch']
    for (let i = 0; i < TOOL_CALL_ROWS; i++) {
      const subjectIndex = i % TOTAL_SUBJECTS
      const isDm = subjectIndex < DM_SUBJECTS
      const subject = isDm ? `u${subjectIndex}` : `g${subjectIndex - DM_SUBJECTS}`
      insertTool.run(
        `e${i}`,
        `t${i}`,
        now - (i % (7 * 24 * 60 * 60 * 1000)),
        subject,
        isDm ? 'dm' : 'group',
        isDm ? subject : `u${i % DM_SUBJECTS}`,
        'm',
        'main',
        toolNames[i % toolNames.length] ?? 'create_task',
        `tc${i}`,
        i % 7 === 0 ? 0 : 1,
      )
    }

    sqlite.run('COMMIT')
  } catch (err) {
    sqlite.run('ROLLBACK')
    throw err
  }
}

describe('stats perf bench', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearStatsCacheForTesting()
    seedFixtures()
  })

  test(`getGlobalStats({ noCache: true }) completes under ${PERF_BUDGET_MS}ms with 1k subjects + 100k messages`, () => {
    const start = performance.now()
    const result = getGlobalStats({ noCache: true })
    const elapsed = performance.now() - start

    expect(result.subjects.dmTotal).toBe(DM_SUBJECTS)
    expect(result.subjects.groupTotal).toBe(GROUP_SUBJECTS)
    expect(elapsed).toBeLessThan(PERF_BUDGET_MS)
  })
})
