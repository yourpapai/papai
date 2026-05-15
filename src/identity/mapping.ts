// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../db/drizzle.js'
import { userIdentityMappings } from '../db/schema.js'
import { logger } from '../logger.js'
import { isMatchMethod } from './types.js'
import type { IdentityMapping, MatchMethod } from './types.js'

const log = logger.child({ scope: 'identity:mapping' })

export interface SetIdentityMappingParams {
  contextId: string
  providerName: string
  providerUserId: string | null
  providerUserLogin: string | null
  displayName: string | null
  matchMethod: MatchMethod
  confidence: number
}

export interface IdentityMappingDeps {
  getDrizzleDb: typeof defaultGetDrizzleDb
}

const defaultDeps: IdentityMappingDeps = {
  getDrizzleDb: defaultGetDrizzleDb,
}

/**
 * Get identity mapping for a user and provider.
 * Returns null if no mapping exists (not yet attempted).
 * Returns mapping with null providerUserId if previously unmatched.
 */
export function getIdentityMapping(
  contextId: string,
  providerName: string,
  deps: IdentityMappingDeps = defaultDeps,
): IdentityMapping | null {
  log.debug({ contextId, providerName }, 'getIdentityMapping called')

  const db = deps.getDrizzleDb()
  const row = db
    .select()
    .from(userIdentityMappings)
    .where(and(eq(userIdentityMappings.contextId, contextId), eq(userIdentityMappings.providerName, providerName)))
    .get()

  if (row === undefined) {
    return null
  }

  return {
    contextId: row.contextId,
    providerName: row.providerName,
    providerUserId: row.providerUserId,
    providerUserLogin: row.providerUserLogin,
    displayName: row.displayName,
    matchedAt: row.matchedAt,
    matchMethod: isMatchMethod(row.matchMethod) ? row.matchMethod : null,
    confidence: row.confidence,
  }
}

/**
 * Store or update identity mapping.
 */
export function setIdentityMapping(params: SetIdentityMappingParams, deps: IdentityMappingDeps = defaultDeps): void {
  log.debug(
    { contextId: params.contextId, providerName: params.providerName, login: params.providerUserLogin },
    'setIdentityMapping called',
  )

  const db = deps.getDrizzleDb()
  db.insert(userIdentityMappings)
    .values({
      contextId: params.contextId,
      providerName: params.providerName,
      providerUserId: params.providerUserId,
      providerUserLogin: params.providerUserLogin,
      displayName: params.displayName,
      matchedAt: new Date().toISOString(),
      matchMethod: params.matchMethod,
      confidence: params.confidence,
    })
    .onConflictDoUpdate({
      target: [userIdentityMappings.contextId, userIdentityMappings.providerName],
      set: {
        providerUserId: params.providerUserId,
        providerUserLogin: params.providerUserLogin,
        displayName: params.displayName,
        matchedAt: new Date().toISOString(),
        matchMethod: params.matchMethod,
        confidence: params.confidence,
      },
    })
    .run()

  log.info(
    { contextId: params.contextId, login: params.providerUserLogin, method: params.matchMethod },
    'Identity mapping stored',
  )
}

/**
 * Clear identity mapping by setting providerUserId to null.
 * Preserves the record to avoid re-attempting auto-link.
 */
export function clearIdentityMapping(
  contextId: string,
  providerName: string,
  deps: IdentityMappingDeps = defaultDeps,
): void {
  log.debug({ contextId, providerName }, 'clearIdentityMapping called')

  const db = deps.getDrizzleDb()
  db.update(userIdentityMappings)
    .set({
      providerUserId: null,
      providerUserLogin: null,
      displayName: null,
      matchMethod: 'unmatched',
      confidence: 0,
      matchedAt: new Date().toISOString(),
    })
    .where(and(eq(userIdentityMappings.contextId, contextId), eq(userIdentityMappings.providerName, providerName)))
    .run()

  log.info({ contextId, providerName }, 'Identity mapping cleared')
}
