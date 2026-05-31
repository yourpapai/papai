// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import type { PluginAdminStateRow, PluginContextStateRow, PluginKvRow } from '../db/plugin-schema.js'
import { pluginAdminState, pluginContextState, pluginKv, pluginRuntimeEvents, systemConfig } from '../db/schema.js'
import { logger } from '../logger.js'
import type { PluginState } from './types.js'

const log = logger.child({ scope: 'plugins:store' })
const LIKE_ESCAPE = '\\'

type PluginAdminStateOptions = Partial<
  Readonly<{
    approvedBy: string | null
    approvedManifestHash: string | null
    lastSeenManifestHash: string | null
    compatibilityReason: string | null
  }>
>

type PluginAdminStateRecord = Readonly<{
  pluginId: string
  state: PluginState
  approvedBy: string | null
  approvedManifestHash: string | null
  lastSeenManifestHash: string | null
  compatibilityReason: string | null
  updatedAt: string
}>

function escapeLikePattern(value: string): string {
  return value
    .replaceAll(LIKE_ESCAPE, `${LIKE_ESCAPE}${LIKE_ESCAPE}`)
    .replaceAll('%', `${LIKE_ESCAPE}%`)
    .replaceAll('_', `${LIKE_ESCAPE}_`)
}

function normalizePluginAdminStateOptions(
  ...rest: [] | [opts: PluginAdminStateOptions]
): Required<PluginAdminStateOptions> {
  const opts = rest.length === 0 ? {} : rest[0]
  let approvedBy: string | null = null
  let approvedManifestHash: string | null = null
  let lastSeenManifestHash: string | null = null
  let compatibilityReason: string | null = null

  if (opts.approvedBy !== undefined) approvedBy = opts.approvedBy
  if (opts.approvedManifestHash !== undefined) approvedManifestHash = opts.approvedManifestHash
  if (opts.lastSeenManifestHash !== undefined) lastSeenManifestHash = opts.lastSeenManifestHash
  if (opts.compatibilityReason !== undefined) compatibilityReason = opts.compatibilityReason

  return {
    approvedBy,
    approvedManifestHash,
    lastSeenManifestHash,
    compatibilityReason,
  }
}

function buildPluginAdminStateRecord(
  pluginId: string,
  state: PluginState,
  updatedAt: string,
  opts: Required<PluginAdminStateOptions>,
): PluginAdminStateRecord {
  return {
    pluginId,
    state,
    approvedBy: opts.approvedBy,
    approvedManifestHash: opts.approvedManifestHash,
    lastSeenManifestHash: opts.lastSeenManifestHash,
    compatibilityReason: opts.compatibilityReason,
    updatedAt,
  }
}

// ---- Admin state ----

export function getPluginAdminState(pluginId: string): PluginAdminStateRow | undefined {
  const db = getDrizzleDb()
  return db.select().from(pluginAdminState).where(eq(pluginAdminState.pluginId, pluginId)).get()
}

export function upsertPluginAdminState(
  pluginId: string,
  state: PluginState,
  ...rest: [] | [opts: PluginAdminStateOptions]
): void {
  const db = getDrizzleDb()
  const now = new Date().toISOString()
  const opts = normalizePluginAdminStateOptions(...rest)
  const values = buildPluginAdminStateRecord(pluginId, state, now, opts)
  db.insert(pluginAdminState)
    .values(values)
    .onConflictDoUpdate({
      target: pluginAdminState.pluginId,
      set: values,
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
  return row === undefined ? undefined : row.value
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

export function kvList(pluginId: string, contextId: string, ...rest: [] | [prefix: string]): PluginKvRow[] {
  const prefix = rest.length === 0 ? undefined : rest[0]
  const db = getDrizzleDb()
  const baseCondition = and(eq(pluginKv.pluginId, pluginId), eq(pluginKv.contextId, contextId))
  if (prefix !== undefined && prefix !== '') {
    const escapedPrefix = `${escapeLikePattern(prefix)}%`
    return db
      .select()
      .from(pluginKv)
      .where(and(baseCondition, sql`${pluginKv.key} LIKE ${escapedPrefix} ESCAPE ${LIKE_ESCAPE}`))
      .all()
  }
  return db.select().from(pluginKv).where(baseCondition).all()
}

// ---- Runtime events ----

export function recordRuntimeEvent(
  pluginId: string,
  eventType: 'activated' | 'deactivated' | 'error' | 'skipped',
  ...rest: [] | [message: string]
): void {
  const message = rest.length === 0 ? undefined : rest[0]
  const db = getDrizzleDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  try {
    let persistedMessage: string | null = null
    if (message !== undefined) persistedMessage = message
    db.insert(pluginRuntimeEvents).values({ id, pluginId, eventType, message: persistedMessage, occurredAt: now }).run()
  } catch (error) {
    log.warn(
      { pluginId, eventType, error: error instanceof Error ? error.message : String(error) },
      'Failed to record plugin runtime event',
    )
  }
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
  return row === undefined ? undefined : row.value
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
