// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { and, eq, type SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryTombstones } from '../db/schema.js'
import type { MemoryScope } from './types.js'

/** Fold case and collapse internal whitespace so trivially-reworded content hashes identically. */
export const normalizeForHash = (content: string): string => content.trim().toLocaleLowerCase().replace(/\s+/gu, ' ')

/** SHA-256 (hex) of the normalized content. The tombstone stores only this — never the content itself. */
export const contentHash = (content: string): string =>
  createHash('sha256').update(normalizeForHash(content), 'utf8').digest('hex')

export const tombstoneValues = (
  scope: MemoryScope,
  content: string,
  now: string,
): { scopeId: string; scopeType: MemoryScope['scopeType']; contentHash: string; forgottenAt: string } => ({
  scopeId: scope.scopeId,
  scopeType: scope.scopeType,
  contentHash: contentHash(content),
  forgottenAt: now,
})

const scopeHashCondition = (scope: MemoryScope, hash: string): SQL | undefined =>
  and(
    eq(memoryTombstones.scopeType, scope.scopeType),
    eq(memoryTombstones.scopeId, scope.scopeId),
    eq(memoryTombstones.contentHash, hash),
  )

export function insertTombstone(scope: MemoryScope, content: string, now: string): void {
  getDrizzleDb()
    .insert(memoryTombstones)
    .values(tombstoneValues(scope, content, now))
    .onConflictDoNothing()
    .run()
}

export function isContentTombstoned(scope: MemoryScope, content: string): boolean {
  const row = getDrizzleDb()
    .select({ hash: memoryTombstones.contentHash })
    .from(memoryTombstones)
    .where(scopeHashCondition(scope, contentHash(content)))
    .get()
  return row !== undefined
}

export function deleteMatchingTombstone(scope: MemoryScope, content: string): void {
  getDrizzleDb()
    .delete(memoryTombstones)
    .where(scopeHashCondition(scope, contentHash(content)))
    .run()
}
