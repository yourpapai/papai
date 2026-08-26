// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, notInArray } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { taskSnapshots } from '../db/schema.js'
import { logger } from '../logger.js'
import type { Task } from '../providers/types.js'

const log = logger.child({ scope: 'deferred:snapshots' })

export const SNAPSHOT_FIELDS: Array<{ field: string; extract: (task: Task) => string | null }> = [
  { field: 'status', extract: (t) => t.status ?? null },
  { field: 'priority', extract: (t) => t.priority ?? null },
  { field: 'assignee', extract: (t) => t.assignee ?? null },
  { field: 'dueDate', extract: (t) => t.dueDate ?? null },
  { field: 'project', extract: (t) => t.projectId ?? null },
  {
    field: 'labels',
    extract: (t) => {
      const names = (t.labels ?? []).map((l) => l.name).sort()
      return names.length > 0 ? names.join(',') : null
    },
  },
]

/** Get all snapshots for a user as a Map<string, string>. Key format: "${taskId}:${fieldName}". */
export function getSnapshotsForUser(userId: string): Map<string, string> {
  log.debug({ userId }, 'Getting snapshots for user')
  const db = getDrizzleDb()

  const rows = db.select().from(taskSnapshots).where(eq(taskSnapshots.userId, userId)).all()

  const result = new Map<string, string>()
  for (const row of rows) {
    result.set(`${row.taskId}:${row.field}`, row.value)
  }
  return result
}

type DrizzleDb = ReturnType<typeof getDrizzleDb>

function writeSnapshotField(
  db: DrizzleDb,
  userId: string,
  task: Task,
  field: string,
  value: string | null,
  now: string,
): void {
  if (value === null) {
    db.delete(taskSnapshots)
      .where(and(eq(taskSnapshots.userId, userId), eq(taskSnapshots.taskId, task.id), eq(taskSnapshots.field, field)))
      .run()
    return
  }
  db.insert(taskSnapshots)
    .values({ userId, taskId: task.id, field, value })
    .onConflictDoUpdate({
      target: [taskSnapshots.userId, taskSnapshots.taskId, taskSnapshots.field],
      set: { value, capturedAt: now },
    })
    .run()
}

/** Capture snapshots for multiple tasks and prune stale entries in a single
 * transaction. A tracked field whose current value is null has its stored row
 * deleted, so a value→null transition does not leave a stale baseline that
 * keeps reporting as changed on later unchanged cycles. */
export function updateSnapshots(
  userId: string,
  tasks: Task[],
  fields: readonly string[] = SNAPSHOT_FIELDS.map(({ field }) => field),
): void {
  log.debug({ userId, taskCount: tasks.length }, 'Updating snapshots')
  const db = getDrizzleDb()
  const now = new Date().toISOString()
  const sqlite = db.$client
  const currentTaskIds = tasks.map((t) => t.id)

  sqlite.run('BEGIN')
  try {
    for (const task of tasks) {
      for (const { field, extract } of SNAPSHOT_FIELDS) {
        if (!fields.includes(field)) continue
        writeSnapshotField(db, userId, task, field, extract(task), now)
      }
    }

    if (currentTaskIds.length > 0) {
      db.delete(taskSnapshots)
        .where(and(eq(taskSnapshots.userId, userId), notInArray(taskSnapshots.taskId, currentTaskIds)))
        .run()
    } else {
      db.delete(taskSnapshots).where(eq(taskSnapshots.userId, userId)).run()
    }

    sqlite.run('COMMIT')
  } catch (error) {
    sqlite.run('ROLLBACK')
    throw error
  }
}
