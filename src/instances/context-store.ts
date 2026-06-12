// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { contextSettings } from '../db/schema.js'
import { logger } from '../logger.js'
import { clearToolCachesForContexts } from './tool-cache-invalidation.js'
import type { ContextSettings } from './types.js'

const log = logger.child({ scope: 'instances:context-store' })

const rowToSettings = (row: typeof contextSettings.$inferSelect): ContextSettings => ({
  contextId: row.contextId,
  taskInstanceId: row.taskInstanceId,
  platformInstanceId: row.platformInstanceId,
})

export const setContextSettings = (input: ContextSettings): void => {
  const existing = getContextSettings(input.contextId)
  getDrizzleDb()
    .insert(contextSettings)
    .values(input)
    .onConflictDoUpdate({
      target: contextSettings.contextId,
      set: {
        taskInstanceId: sql`excluded.task_instance_id`,
        platformInstanceId: sql`excluded.platform_instance_id`,
      },
    })
    .run()
  const contextIds = existing === null ? [input.contextId] : [input.contextId, existing.contextId]
  clearToolCachesForContexts(contextIds)
  log.info(
    {
      contextId: input.contextId,
      taskInstanceId: input.taskInstanceId,
      platformInstanceId: input.platformInstanceId,
    },
    'context settings upserted',
  )
}

export const getContextSettings = (contextId: string): ContextSettings | null => {
  const row = getDrizzleDb().select().from(contextSettings).where(eq(contextSettings.contextId, contextId)).get()
  return row === undefined ? null : rowToSettings(row)
}

export const listContextSettings = (): ContextSettings[] => {
  const rows = getDrizzleDb().select().from(contextSettings).all()
  return rows.map((row) => rowToSettings(row))
}

export const listContextsByTaskInstance = (taskInstanceId: string): ContextSettings[] => {
  const rows = getDrizzleDb()
    .select()
    .from(contextSettings)
    .where(eq(contextSettings.taskInstanceId, taskInstanceId))
    .all()
  return rows.map((row) => rowToSettings(row))
}

export const listContextsByPlatformInstance = (platformInstanceId: string): ContextSettings[] => {
  const rows = getDrizzleDb()
    .select()
    .from(contextSettings)
    .where(eq(contextSettings.platformInstanceId, platformInstanceId))
    .all()
  return rows.map((row) => rowToSettings(row))
}
