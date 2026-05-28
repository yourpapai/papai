// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, like, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import type {
  PluginAdminStateRow,
  PluginContextStateRow,
  PluginKvRow,
  PluginRuntimeEventRow,
} from '../db/plugin-schema.js'
import { pluginAdminState, pluginContextState, pluginKv, pluginRuntimeEvents, systemConfig } from '../db/schema.js'
import { logger } from '../logger.js'
import type { PluginState } from './types.js'

const log = logger.child({ scope: 'plugins:store' })

// ---- Admin state ----

export function getPluginAdminState(pluginId: string): PluginAdminStateRow | undefined {
  const db = getDrizzleDb()
  return db.select().from(pluginAdminState).where(eq(pluginAdminState.pluginId, pluginId)).get()
}

export function getAllPluginAdminStates(): PluginAdminStateRow[] {
  const db = getDrizzleDb()
  return db.select().from(pluginAdminState).all()
}

export function upsertPluginAdminState(
  pluginId: string,
  state: PluginState,
  opts: {
    approvedBy?: string | null
    approvedManifestHash?: string | null
    lastSeenManifestHash?: string | null
    compatibilityReason?: string | null
  } = {},
): void {
  const db = getDrizzleDb()
  const now = new Date().toISOString()
  db.insert(pluginAdminState)
    .values({
      pluginId,
      state,
      approvedBy: opts.approvedBy ?? null,
      approvedManifestHash: opts.approvedManifestHash ?? null,
      lastSeenManifestHash: opts.lastSeenManifestHash ?? null,
      compatibilityReason: opts.compatibilityReason ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pluginAdminState.pluginId,
      set: {
        state,
        approvedBy: opts.approvedBy ?? null,
        approvedManifestHash: opts.approvedManifestHash ?? null,
        lastSeenManifestHash: opts.lastSeenManifestHash ?? null,
        compatibilityReason: opts.compatibilityReason ?? null,
        updatedAt: now,
      },
    })
    .run()
  log.debug({ pluginId, state }, 'Plugin admin state upserted')
}

export function updatePluginAdminStateField(
  pluginId: string,
  fields: Partial<{
    state: PluginState
    approvedBy: string | null
    approvedManifestHash: string | null
    lastSeenManifestHash: string | null
    compatibilityReason: string | null
  }>,
): void {
  const db = getDrizzleDb()
  db.update(pluginAdminState)
    .set({ ...fields, updatedAt: new Date().toISOString() })
    .where(eq(pluginAdminState.pluginId, pluginId))
    .run()
}

// ---- Context state ----

export function getPluginContextState(pluginId: string, contextId: string): PluginContextStateRow | undefined {
  const db = getDrizzleDb()
  return db
    .select()
    .from(pluginContextState)
    .where(and(eq(pluginContextState.pluginId, pluginId), eq(pluginContextState.contextId, contextId)))
    .get()
}

export function isPluginEnabledForContext(pluginId: string, contextId: string): boolean {
  const row = getPluginContextState(pluginId, contextId)
  return row?.enabled === true
}

export function setPluginContextEnabled(pluginId: string, contextId: string, enabled: boolean): void {
  const db = getDrizzleDb()
  const now = new Date().toISOString()
  db.insert(pluginContextState)
    .values({ pluginId, contextId, enabled, updatedAt: now })
    .onConflictDoUpdate({
      target: [pluginContextState.pluginId, pluginContextState.contextId],
      set: { enabled, updatedAt: now },
    })
    .run()
  log.debug({ pluginId, contextId, enabled }, 'Plugin context state updated')
}

export function getEnabledPluginsForContext(contextId: string): string[] {
  const db = getDrizzleDb()
  return db
    .select({ pluginId: pluginContextState.pluginId })
    .from(pluginContextState)
    .where(and(eq(pluginContextState.contextId, contextId), eq(pluginContextState.enabled, true)))
    .all()
    .map((r) => r.pluginId)
}

export function getEnabledContextsForPlugin(pluginId: string): string[] {
  const db = getDrizzleDb()
  return db
    .select({ contextId: pluginContextState.contextId })
    .from(pluginContextState)
    .where(and(eq(pluginContextState.pluginId, pluginId), eq(pluginContextState.enabled, true)))
    .all()
    .map((r) => r.contextId)
}

export function getContextStatesForPlugin(pluginId: string): Array<{ contextId: string; enabled: boolean }> {
  const db = getDrizzleDb()
  return db
    .select({ contextId: pluginContextState.contextId, enabled: pluginContextState.enabled })
    .from(pluginContextState)
    .where(eq(pluginContextState.pluginId, pluginId))
    .all()
}

// ---- KV store ----

export function kvGet(pluginId: string, contextId: string, key: string): string | undefined {
  const db = getDrizzleDb()
  const row = db
    .select({ value: pluginKv.value })
    .from(pluginKv)
    .where(and(eq(pluginKv.pluginId, pluginId), eq(pluginKv.contextId, contextId), eq(pluginKv.key, key)))
    .get()
  return row?.value
}

export function kvSet(pluginId: string, contextId: string, key: string, value: string): void {
  const db = getDrizzleDb()
  const now = new Date().toISOString()
  db.insert(pluginKv)
    .values({ pluginId, contextId, key, value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [pluginKv.pluginId, pluginKv.contextId, pluginKv.key],
      set: { value, updatedAt: now },
    })
    .run()
}

export function kvDelete(pluginId: string, contextId: string, key: string): void {
  const db = getDrizzleDb()
  db.delete(pluginKv)
    .where(and(eq(pluginKv.pluginId, pluginId), eq(pluginKv.contextId, contextId), eq(pluginKv.key, key)))
    .run()
}

export function kvList(pluginId: string, contextId: string, prefix?: string): PluginKvRow[] {
  const db = getDrizzleDb()
  const baseCondition = and(eq(pluginKv.pluginId, pluginId), eq(pluginKv.contextId, contextId))
  if (prefix !== undefined && prefix !== '') {
    return db
      .select()
      .from(pluginKv)
      .where(and(baseCondition, like(pluginKv.key, `${prefix}%`)))
      .all()
  }
  return db.select().from(pluginKv).where(baseCondition).all()
}

// ---- Runtime events ----

export function recordRuntimeEvent(
  pluginId: string,
  eventType: 'activated' | 'deactivated' | 'error' | 'skipped',
  message?: string,
): void {
  const db = getDrizzleDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  try {
    db.insert(pluginRuntimeEvents)
      .values({ id, pluginId, eventType, message: message ?? null, occurredAt: now })
      .run()
  } catch (error) {
    log.warn(
      { pluginId, eventType, error: error instanceof Error ? error.message : String(error) },
      'Failed to record plugin runtime event',
    )
  }
}

type PluginRuntimeEventSummary = Pick<PluginRuntimeEventRow, 'eventType' | 'message' | 'occurredAt'>

export function getRecentRuntimeEvents(pluginId: string, limit = 20): PluginRuntimeEventSummary[] {
  const db = getDrizzleDb()
  return db
    .select({
      eventType: pluginRuntimeEvents.eventType,
      message: pluginRuntimeEvents.message,
      occurredAt: pluginRuntimeEvents.occurredAt,
    })
    .from(pluginRuntimeEvents)
    .where(eq(pluginRuntimeEvents.pluginId, pluginId))
    .orderBy(sql`${pluginRuntimeEvents.occurredAt} DESC`)
    .limit(limit)
    .all()
}

// ---- Admin config ----

function pluginAdminConfigKey(pluginId: string, key: string): string {
  return `plg:${pluginId}:${key}`
}

export function getPluginAdminConfig(pluginId: string, key: string): string | undefined {
  const row = getDrizzleDb()
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, pluginAdminConfigKey(pluginId, key)))
    .get()
  return row?.value
}

export function setPluginAdminConfig(pluginId: string, key: string, value: string, updatedBy: string): void {
  const dbKey = pluginAdminConfigKey(pluginId, key)
  const updatedAt = Date.now()
  getDrizzleDb()
    .insert(systemConfig)
    .values({ key: dbKey, value, updatedAt, updatedBy })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: sql`excluded.value`,
        updatedAt: sql`excluded.updated_at`,
        updatedBy: sql`excluded.updated_by`,
      },
    })
    .run()
  log.debug({ pluginId, key, updatedBy }, 'Plugin admin config set')
}
