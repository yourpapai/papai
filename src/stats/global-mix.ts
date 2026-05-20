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
  users,
} from '../db/schema.js'
import type { IdentityMixStats, StorageFootprint, SurfaceMixStats } from './types.js'

interface StorageGlobalOptions {
  dbFileSize?: () => number
}

function defaultDbFileSize(): number {
  const dbPath = process.env['DB_PATH'] ?? 'papai.db'
  try {
    return statSync(dbPath).size
  } catch {
    return 0
  }
}

export function storageGlobal(opts: StorageGlobalOptions = {}): StorageFootprint {
  const row = getDrizzleDb()
    .select({ total: sql<number>`coalesce(sum(${attachments.size}), 0)`.as('total') })
    .from(attachments)
    .where(eq(attachments.isActive, 1))
    .all()
  return {
    s3AttachmentBytes: row[0]?.total ?? 0,
    sqliteBytes: opts.dbFileSize?.() ?? defaultDbFileSize(),
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
    .from(users)
    .where(sql`${users.kaneoWorkspaceId} is not null and ${users.kaneoWorkspaceId} != ''`)
    .all()

  return { byProvider, kaneoWorkspaces: kaneoRow[0]?.c ?? 0 }
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

  return {
    subjectsWithMemos: memoRow[0]?.c ?? 0,
    subjectsWithRecurring: recurringRow[0]?.c ?? 0,
    subjectsWithDeferred: deferredRow[0]?.c ?? 0,
    subjectsWithInstructions: instructionsRow[0]?.c ?? 0,
  }
}
