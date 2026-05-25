// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { deleteInstructionFromDb, syncInstructionToDb } from './cache-db.js'
import type { CachedInstruction } from './cache-types.js'
import { getOrCreateCache } from './cache.js'
import { getDrizzleDb } from './db/drizzle.js'
import { userInstructions } from './db/schema.js'
import { emitUser } from './debug/event-bus.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'cache:instructions' })

export function getCachedInstructions(contextId: string): readonly CachedInstruction[] {
  const cache = getOrCreateCache(contextId)
  if (cache.instructions === null) {
    log.debug({ contextId }, 'Loading instructions from DB into cache')
    const rows = getDrizzleDb()
      .select({ id: userInstructions.id, text: userInstructions.text, createdAt: userInstructions.createdAt })
      .from(userInstructions)
      .where(sql`${userInstructions.contextId} = ${contextId}`)
      .orderBy(sql`${userInstructions.createdAt} ASC`)
      .all()
    cache.instructions = rows
    emitUser('cache:load', contextId, { field: 'instructions' })
  }
  return cache.instructions
}

export function addCachedInstruction(contextId: string, instruction: { id: string; text: string }): void {
  const cache = getOrCreateCache(contextId)
  if (!Array.isArray(cache.instructions)) {
    cache.instructions = []
  }
  const createdAt = new Date().toISOString()
  cache.instructions.push({ ...instruction, createdAt })
  syncInstructionToDb(contextId, { ...instruction, createdAt })
  emitUser('cache:sync', contextId, { field: 'instructions', operation: 'set' })
}

export function deleteCachedInstruction(contextId: string, id: string): void {
  const cache = getOrCreateCache(contextId)
  if (cache.instructions !== null) {
    cache.instructions = cache.instructions.filter((i) => i.id !== id)
  }
  deleteInstructionFromDb(contextId, id)
  emitUser('cache:sync', contextId, { field: 'instructions', operation: 'delete' })
}
