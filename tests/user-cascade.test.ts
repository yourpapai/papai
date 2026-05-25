// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import * as schema from '../src/db/schema.js'
import { addUser, removeUser } from '../src/users.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const countRows = (
  db: Awaited<ReturnType<typeof setupTestDb>>,
  table: string,
  whereSql: string,
  params: string[],
): number => {
  const row = db.$client
    .query<{ count: number }, string[]>(`SELECT count(*) AS count FROM ${table} WHERE ${whereSql}`)
    .get(...params)
  return row?.count ?? 0
}

describe('user removal cascade integration', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    mockLogger()
    testDb = await setupTestDb()
  })

  test('removes recurring templates and occurrences when an authorized user is deleted', () => {
    addUser('cascade-user', 'admin')

    testDb
      .insert(schema.recurringTasks)
      .values({
        id: 'rt-cascade',
        userId: 'cascade-user',
        projectId: 'project-1',
        title: 'Recurring',
        triggerType: 'cron',
      })
      .run()
    testDb
      .insert(schema.recurringTaskOccurrences)
      .values({ id: 'occ-cascade', templateId: 'rt-cascade', taskId: 'task-1' })
      .run()

    expect(removeUser('cascade-user')).toBe(true)

    expect(countRows(testDb, 'recurring_tasks', 'user_id = ?', ['cascade-user'])).toBe(0)
    expect(countRows(testDb, 'recurring_task_occurrences', 'template_id = ?', ['rt-cascade'])).toBe(0)
  })

  test('does not affect another users recurring data when one user is deleted', () => {
    addUser('user-a', 'admin')
    addUser('user-b', 'admin')

    testDb
      .insert(schema.recurringTasks)
      .values({
        id: 'rt-a',
        userId: 'user-a',
        projectId: 'project-a',
        title: 'Recurring A',
        triggerType: 'cron',
      })
      .run()
    testDb.insert(schema.recurringTaskOccurrences).values({ id: 'occ-a', templateId: 'rt-a', taskId: 'task-a' }).run()
    testDb
      .insert(schema.recurringTasks)
      .values({
        id: 'rt-b',
        userId: 'user-b',
        projectId: 'project-b',
        title: 'Recurring B',
        triggerType: 'cron',
      })
      .run()
    testDb.insert(schema.recurringTaskOccurrences).values({ id: 'occ-b', templateId: 'rt-b', taskId: 'task-b' }).run()

    expect(removeUser('user-a')).toBe(true)

    const remainingUser = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, 'user-b')).get()
    const remainingTask = testDb.select().from(schema.recurringTasks).where(eq(schema.recurringTasks.id, 'rt-b')).get()
    const remainingOccurrence = testDb
      .select()
      .from(schema.recurringTaskOccurrences)
      .where(eq(schema.recurringTaskOccurrences.id, 'occ-b'))
      .get()

    expect(remainingUser).toBeDefined()
    expect(remainingTask?.userId).toBe('user-b')
    expect(remainingOccurrence?.templateId).toBe('rt-b')
    expect(testDb.select().from(schema.users).where(eq(schema.users.platformUserId, 'user-a')).get()).toBeUndefined()
    expect(
      testDb.select().from(schema.recurringTasks).where(eq(schema.recurringTasks.id, 'rt-a')).get(),
    ).toBeUndefined()
  })
})
