// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, sql } from 'drizzle-orm'

import { getFeatureObserver, type TaskProviderName } from '../analytics/feature-observer.js'
import type { AnalyticsRequestContext } from '../analytics/provider-observer.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { contextSettings } from '../db/schema.js'
import { logger } from '../logger.js'
import { getTaskInstance } from './task-store.js'
import { clearToolCachesForContexts } from './tool-cache-invalidation.js'
import type { ContextSettings } from './types.js'

const log = logger.child({ scope: 'instances:context-store' })

const providerNameOf = (taskInstanceId: string | null): TaskProviderName => {
  if (taskInstanceId === null) return 'none'
  const type = getTaskInstance(taskInstanceId)?.type
  if (type === 'kaneo') return 'kaneo'
  if (type === 'youtrack') return 'youtrack'
  return 'other'
}

/**
 * Single source of truth for task-assignment milestones, emitted from the
 * transactional mutation path so manual settings and cold-context flows share
 * one emission point. Only fires on an actual assignment change with an
 * explicit actor context; never infers an actor.
 */
const observeTaskInstanceAssigned = (
  existing: ContextSettings | null,
  input: ContextSettings,
  actorContext: AnalyticsRequestContext | null,
): void => {
  if (input.taskInstanceId === null) return
  const previousTaskInstanceId = existing?.taskInstanceId ?? null
  if (previousTaskInstanceId === input.taskInstanceId) return
  if (actorContext === null) return
  const observer = getFeatureObserver()
  if (observer === null) return
  const toProvider = providerNameOf(input.taskInstanceId)
  if (toProvider === 'none') return
  observer.taskInstanceAssigned(actorContext, {
    change: previousTaskInstanceId === null ? 'first_assignment' : 'changed',
    fromProvider: providerNameOf(previousTaskInstanceId),
    toProvider,
  })
}

const rowToSettings = (row: typeof contextSettings.$inferSelect): ContextSettings => ({
  contextId: row.contextId,
  taskInstanceId: row.taskInstanceId,
  platformInstanceId: row.platformInstanceId,
})

export const setContextSettings = (
  input: ContextSettings,
  actorContext: AnalyticsRequestContext | null = null,
): void => {
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
  observeTaskInstanceAssigned(existing, input, actorContext)
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

// Seeds a platform-only assignment (task instance left null) the first time a context
// is seen, so new users are visible in admin/settings surfaces before they run /config.
// ON CONFLICT DO NOTHING never clobbers an existing row (incl. a real task assignment),
// and a null task instance does not change tool/provider resolution, so no cache invalidation.
export const ensureContextPlatformInstance = (contextId: string, platformInstanceId: string): void => {
  getDrizzleDb()
    .insert(contextSettings)
    .values({ contextId, taskInstanceId: null, platformInstanceId })
    .onConflictDoNothing({ target: contextSettings.contextId })
    .run()
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
