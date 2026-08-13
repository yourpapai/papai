// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, asc, eq, gte, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { SpecStage } from '../context-vault/reducer.js'
import { contextVaultIndexerState, contextVaultSpecs, type ContextVaultSpecRow } from '../db/context-vault-schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { deny } from './deny.js'

export type ContextVaultSpecSummary = {
  id: string
  repo: string
  name: string
  oneLine: string
  stage: string
  progressPct: number
  mtime: number
}

export type ContextVaultSpecDetail = ContextVaultSpecSummary & {
  summary: string | null
  outline: string[]
}

export type ContextVaultListFilter = {
  repo?: string
  status?: SpecStage
  changedSince?: number
}

export type ContextVaultListResult = {
  specs: ContextVaultSpecSummary[]
  meta: { lastPushAt: number | null }
}

export type ContextVaultGetResult =
  | { ok: true; spec: ContextVaultSpecDetail; meta: { lastPushAt: number | null } }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'ambiguous'; candidates: string[] }

const OutlineSchema = z.array(z.string())

const lastPushAtOf = (configContextId: string): number | null =>
  getDrizzleDb()
    .select()
    .from(contextVaultIndexerState)
    .where(eq(contextVaultIndexerState.configContextId, configContextId))
    .get()?.lastPushAt ?? null

const toSummary = (row: ContextVaultSpecRow): ContextVaultSpecSummary => ({
  id: row.id,
  repo: row.repo,
  name: row.changeName,
  oneLine: row.oneLine,
  stage: row.stage,
  progressPct: row.progressPct,
  mtime: row.mtime,
})

const toDetail = (row: ContextVaultSpecRow): ContextVaultSpecDetail => {
  const parsed = OutlineSchema.safeParse(row.outline === null ? [] : JSON.parse(row.outline))
  return { ...toSummary(row), summary: row.summary, outline: parsed.success ? parsed.data : [] }
}

const listRows = (configContextId: string, filter: ContextVaultListFilter): ContextVaultSpecRow[] => {
  const conditions: SQL[] = [eq(contextVaultSpecs.configContextId, configContextId)]
  if (filter.repo !== undefined) conditions.push(eq(contextVaultSpecs.repo, filter.repo))
  if (filter.status !== undefined) conditions.push(eq(contextVaultSpecs.stage, filter.status))
  if (filter.changedSince !== undefined) conditions.push(gte(contextVaultSpecs.mtime, filter.changedSince))
  return getDrizzleDb()
    .select()
    .from(contextVaultSpecs)
    .where(and(...conditions))
    .orderBy(asc(contextVaultSpecs.mtime), asc(contextVaultSpecs.id))
    .all()
}

const getSpec = (configContextId: string, idOrName: string): ContextVaultGetResult => {
  const db = getDrizzleDb()
  if (idOrName.includes(':')) {
    const row = db
      .select()
      .from(contextVaultSpecs)
      .where(and(eq(contextVaultSpecs.configContextId, configContextId), eq(contextVaultSpecs.id, idOrName)))
      .get()
    if (row === undefined) return { ok: false, reason: 'not-found' }
    return { ok: true, spec: toDetail(row), meta: { lastPushAt: lastPushAtOf(configContextId) } }
  }
  const matches = db
    .select()
    .from(contextVaultSpecs)
    .where(and(eq(contextVaultSpecs.configContextId, configContextId), eq(contextVaultSpecs.changeName, idOrName)))
    .orderBy(asc(contextVaultSpecs.id))
    .all()
  if (matches.length === 0) return { ok: false, reason: 'not-found' }
  const first = matches[0]
  if (matches.length > 1 || first === undefined) {
    return { ok: false, reason: 'ambiguous', candidates: matches.map((row) => row.id) }
  }
  return { ok: true, spec: toDetail(first), meta: { lastPushAt: lastPushAtOf(configContextId) } }
}

/**
 * Read-only facade over the context vault for plugins. Resolves the group
 * config-context from the raw (possibly thread-scoped) storage context id so
 * sibling threads share one vault. Every read is gated on `contextVault.read`.
 */
export function buildContextVaultFacade(
  pluginId: string,
  storageContextId: string,
  hasPermission: boolean,
): {
  list(filter?: ContextVaultListFilter): ContextVaultListResult
  get(idOrName: string): ContextVaultGetResult
} {
  return Object.freeze({
    list(filter: ContextVaultListFilter = {}): ContextVaultListResult {
      if (!hasPermission) deny(pluginId, 'contextVault.read')
      const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
      return {
        specs: listRows(configContextId, filter).map(toSummary),
        meta: { lastPushAt: lastPushAtOf(configContextId) },
      }
    },
    get(idOrName: string): ContextVaultGetResult {
      if (!hasPermission) deny(pluginId, 'contextVault.read')
      const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
      return getSpec(configContextId, idOrName)
    },
  })
}
