// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, asc, eq, ne } from 'drizzle-orm'

import { analyticsEvents, analyticsRekeyMappings } from '../../db/schema.js'
import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import { openMappingForVerify } from './mapping-store.js'
import type { RekeyMappingPair } from './mapping-store.js'
import type { RekeyTx } from './run-store.js'

export type ParentPair = Readonly<{ activeEventId: string; shadowEventId: string }>

const openRunPairsIn = (tx: RekeyTx, runId: string, encryptionKeys: readonly Buffer[]): readonly RekeyMappingPair[] => {
  const rows = tx
    .select()
    .from(analyticsRekeyMappings)
    .where(and(eq(analyticsRekeyMappings.runId, runId), ne(analyticsRekeyMappings.state, 'destroyed')))
    .all()
  const pairs: RekeyMappingPair[] = []
  for (const row of rows) {
    let lastError: unknown = new Error('no retained key to open the rekey mapping')
    let opened: RekeyMappingPair | null = null
    for (const encryptionKey of encryptionKeys) {
      try {
        opened = openMappingForVerify(row.mappingCiphertext, encryptionKey)
        break
      } catch (error) {
        lastError = error
      }
    }
    if (opened === null) throw lastError instanceof Error ? lastError : new Error(String(lastError))
    pairs.push(opened)
  }
  return pairs
}

export const eventIdsIn = (tx: RekeyTx, generation: string): readonly string[] =>
  tx
    .select({ eventId: analyticsEvents.eventId })
    .from(analyticsEvents)
    .where(eq(analyticsEvents.storageGeneration, generation))
    .orderBy(asc(analyticsEvents.eventId))
    .all()
    .map((row) => row.eventId)

export const loadParentPairsIn = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  encryptionKeys: readonly Buffer[],
): Readonly<{ pairs: readonly ParentPair[]; shadowToActive: ReadonlyMap<string, string> }> => {
  const activeIds = new Set(eventIdsIn(tx, run.sourceGeneration))
  const shadowIds = new Set(eventIdsIn(tx, run.targetGeneration))
  const pairs: ParentPair[] = []
  const shadowToActive = new Map<string, string>()
  for (const pair of openRunPairsIn(tx, run.runId, encryptionKeys)) {
    if (pair.domain !== 'event-source-ref:v1') continue
    if (!activeIds.has(pair.oldKey) || !shadowIds.has(pair.newKey)) continue
    pairs.push({ activeEventId: pair.oldKey, shadowEventId: pair.newKey })
    shadowToActive.set(pair.newKey, pair.oldKey)
  }
  return { pairs, shadowToActive }
}

/** Retire checks need every decrypted pair, not only the parent domain. */
export const listRunPairsIn = (
  tx: RekeyTx,
  runId: string,
  encryptionKeys: readonly Buffer[],
): readonly RekeyMappingPair[] => openRunPairsIn(tx, runId, encryptionKeys)
