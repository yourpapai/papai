// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { statSync } from 'node:fs'

import { eq, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import {
  attachments,
  scheduledPrompts,
  userIdentityMappings,
  memos,
  recurringTasks,
  userInstructions,
  userConfig,
} from '../db/schema.js'
import { KANEO_WORKSPACE_CONFIG_KEY } from '../types/config.js'
import type { IdentityMixStats, StorageFootprint, SurfaceMixStats } from './types.js'

type StorageGlobalOptions = Readonly<{ dbFileSize: () => number }>

function dbFileSize(dbPath: string): number {
  try {
    return statSync(dbPath).size
  } catch {
    return 0
  }
}

function defaultDbFileSize(): number {
  const configuredDbPath = process.env['DB_PATH']
  if (configuredDbPath === undefined) return dbFileSize('papai.db')
  return dbFileSize(configuredDbPath)
}

export function storageGlobal(): StorageFootprint
export function storageGlobal(opts: StorageGlobalOptions): StorageFootprint
export function storageGlobal(...args: readonly [] | readonly [StorageGlobalOptions]): StorageFootprint {
  const row = getDrizzleDb()
    .select({ total: sql<number>`coalesce(sum(${attachments.size}), 0)`.as('total') })
    .from(attachments)
    .where(eq(attachments.isActive, 1))
    .all()
  const firstRow = row[0]
  const opts = args[0]
  const sqliteBytes = opts === undefined ? defaultDbFileSize() : opts.dbFileSize()

  return {
    s3AttachmentBytes: firstRow === undefined ? 0 : firstRow.total,
    sqliteBytes,
  }
}

export function identityMixGlobal(): IdentityMixStats {
  const providerRows = getDrizzleDb()
    .select({
      providerName: userIdentityMappings.providerName,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(userIdentityMappings)
    .groupBy(userIdentityMappings.providerName)
    .all()

  const byProvider: Record<string, number> = {}
  for (const r of providerRows) byProvider[r.providerName] = r.count

  const kaneoRow = getDrizzleDb()
    .select({ c: sql<number>`count(*)`.as('c') })
    .from(userConfig)
    .where(sql`${userConfig.key} = ${KANEO_WORKSPACE_CONFIG_KEY} and ${userConfig.value} != ''`)
    .all()

  const firstKaneoRow = kaneoRow[0]
  return { byProvider, kaneoWorkspaces: firstKaneoRow === undefined ? 0 : firstKaneoRow.c }
}

export function surfaceMixGlobal(): SurfaceMixStats {
  const memoRow = getDrizzleDb()
    .select({ c: sql<number>`count(distinct ${memos.userId})`.as('c') })
    .from(memos)
    .all()
  const recurringRow = getDrizzleDb()
    .select({ c: sql<number>`count(distinct ${recurringTasks.userId})`.as('c') })
    .from(recurringTasks)
    .all()
  const deferredRow = getDrizzleDb()
    .select({ c: sql<number>`count(distinct ${scheduledPrompts.createdByUserId})`.as('c') })
    .from(scheduledPrompts)
    .all()
  const instructionsRow = getDrizzleDb()
    .select({ c: sql<number>`count(distinct ${userInstructions.contextId})`.as('c') })
    .from(userInstructions)
    .all()

  const firstMemoRow = memoRow[0]
  const firstRecurringRow = recurringRow[0]
  const firstDeferredRow = deferredRow[0]
  const firstInstructionsRow = instructionsRow[0]

  return {
    subjectsWithMemos: firstMemoRow === undefined ? 0 : firstMemoRow.c,
    subjectsWithRecurring: firstRecurringRow === undefined ? 0 : firstRecurringRow.c,
    subjectsWithDeferred: firstDeferredRow === undefined ? 0 : firstDeferredRow.c,
    subjectsWithInstructions: firstInstructionsRow === undefined ? 0 : firstInstructionsRow.c,
  }
}
