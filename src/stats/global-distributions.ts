// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { attachments, memos, messageMetadata, recurringTasks } from '../db/schema.js'
import { percentiles } from './aggregate.js'
import type { GlobalDistributions } from './types.js'

function countsBySubject(rows: ReadonlyArray<{ value: number }>): number[] {
  return rows.map((r) => r.value)
}

export function distributionsGlobal(): GlobalDistributions {
  const memoRows = getDrizzleDb()
    .select({ value: sql<number>`count(*)`.as('value') })
    .from(memos)
    .groupBy(memos.userId)
    .all()

  const recurringRows = getDrizzleDb()
    .select({ value: sql<number>`count(*)`.as('value') })
    .from(recurringTasks)
    .groupBy(recurringTasks.userId)
    .all()

  const messageRows = getDrizzleDb()
    .select({ value: sql<number>`count(*)`.as('value') })
    .from(messageMetadata)
    .groupBy(messageMetadata.contextId)
    .all()

  const attachmentRows = getDrizzleDb()
    .select({ value: sql<number>`coalesce(sum(${attachments.size}), 0)`.as('value') })
    .from(attachments)
    .groupBy(attachments.contextId)
    .all()

  return {
    memosPerSubject: percentiles(countsBySubject(memoRows)),
    recurringTasksPerSubject: percentiles(countsBySubject(recurringRows)),
    messageMetadataPerSubject: percentiles(countsBySubject(messageRows)),
    attachmentBytesPerSubject: percentiles(countsBySubject(attachmentRows)),
  }
}
