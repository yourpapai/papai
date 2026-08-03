// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { RekeyTx } from './run-store.js'
import { eventIdsIn, loadParentPairsIn } from './verify-pairs.js'

const log = logger.child({ scope: 'analytics:rekey:verify' })

export type ShadowEquationReport = Readonly<{
  activeParentCount: number
  shadowParentCount: number
  mappedPairCount: number
  countsEqual: boolean
  activeHash: string
  normalizedShadowHash: string
  hashesEqual: boolean
  ok: boolean
}>

export const canonical = (row: Record<string, unknown>): string =>
  JSON.stringify(
    Object.fromEntries(Object.entries(row).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))),
  )

const hashSequence = (ids: readonly string[]): string => {
  const hash = createHash('sha256')
  for (const id of ids) {
    const bytes = Buffer.from(id, 'utf8')
    const length = Buffer.alloc(4)
    length.writeUInt32BE(bytes.byteLength, 0)
    hash.update(length)
    hash.update(bytes)
  }
  return hash.digest('hex')
}

/**
 * The separate, non-balanceable shadow equation: active parent count equals
 * target-shadow parent count equals the count of encrypted run mappings with
 * exactly one existing parent in each generation, and SHA-256 of the ordered
 * active IDs equals SHA-256 of the in-memory normalized target IDs. Mappings
 * are decrypted only inside this verifier; nothing normalized is persisted.
 */
export const verifyShadowEquationIn = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  encryptionKeys: readonly Buffer[],
): ShadowEquationReport => {
  const activeIds = eventIdsIn(tx, run.sourceGeneration)
  const shadowIds = eventIdsIn(tx, run.targetGeneration)
  const { pairs, shadowToActive } = loadParentPairsIn(tx, run, encryptionKeys)
  const normalizedShadow = shadowIds.map((eventId) => shadowToActive.get(eventId) ?? eventId)
  const activeHash = hashSequence(activeIds)
  const normalizedShadowHash = hashSequence([...normalizedShadow].sort())
  const countsEqual = activeIds.length === shadowIds.length && shadowIds.length === pairs.length
  const hashesEqual = activeHash === normalizedShadowHash
  const everyShadowMapped = shadowIds.every((eventId) => shadowToActive.has(eventId))
  const ok = countsEqual && hashesEqual && everyShadowMapped
  if (!ok) log.warn({ countsEqual, hashesEqual, everyShadowMapped }, 'rekey shadow equation failed')
  return {
    activeParentCount: activeIds.length,
    shadowParentCount: shadowIds.length,
    mappedPairCount: pairs.length,
    countsEqual,
    activeHash,
    normalizedShadowHash,
    hashesEqual,
    ok,
  }
}
