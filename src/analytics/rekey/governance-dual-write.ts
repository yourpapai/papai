// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { logger } from '../../logger.js'
import { parseGovernanceKeyring } from '../identity/keyring.js'
import { deriveRekeyedPseudonym } from '../identity/pseudonym.js'
import { getNonterminalRekeyRun, isDualWriteActive, parseRekeyVersions } from './run-store.js'

const log = logger.child({ scope: 'analytics:rekey:governance-dual-write' })

export type GovernanceDualWriteDomain = 'governance-actor:v1' | 'collection-eligibility:v1' | 'delivery-grant:v1'

export type GovernanceDualWriteTarget = Readonly<{ key: string; keyVersion: string }>

export type GovernanceDualWriteResolver = (
  domain: GovernanceDualWriteDomain,
  oldKey: string,
) => GovernanceDualWriteTarget | null

export type GovernanceKeyMaterial = Readonly<{ toVersion: string; toKey: Buffer }>

export type GovernanceDualWriteResolverDeps = Readonly<{
  getDrizzleDb?: typeof defaultGetDrizzleDb
  getGovernanceKey: () => GovernanceKeyMaterial | null
}>

/**
 * Resolves the target key version for a governance key while a rekey run has
 * dual-write armed. Returns null when no run is armed; fails closed when a
 * run is armed but the target governance key is unavailable.
 */
export const createGovernanceDualWriteResolver = (
  deps: GovernanceDualWriteResolverDeps,
): GovernanceDualWriteResolver => {
  const getDrizzleDb = deps.getDrizzleDb ?? defaultGetDrizzleDb
  return (domain, oldKey) => {
    const run = getNonterminalRekeyRun({ getDrizzleDb })
    if (run === null || !isDualWriteActive(run)) return null
    const material = deps.getGovernanceKey()
    if (material === null) {
      log.warn('governance dual-write refused: target governance key unavailable')
      throw new Error('governance rekey key material unavailable while dual-write is armed')
    }
    return {
      key: deriveRekeyedPseudonym({
        key: material.toKey,
        keyVersion: material.toVersion,
        domain,
        sourcePseudonym: oldKey,
      }),
      keyVersion: material.toVersion,
    }
  }
}

/** Production resolver: target governance key from the env keyring. */
export const createDefaultGovernanceDualWriteResolver = (
  getDrizzleDb: typeof defaultGetDrizzleDb,
): GovernanceDualWriteResolver =>
  createGovernanceDualWriteResolver({
    getDrizzleDb,
    getGovernanceKey: () => {
      const run = getNonterminalRekeyRun({ getDrizzleDb })
      if (run === null) return null
      const toVersion = parseRekeyVersions(run.toVersions)[0]
      if (toVersion === undefined) return null
      const keyring = parseGovernanceKeyring()
      if (keyring.kind !== 'available') return null
      const toKey = keyring.keys.get(toVersion)
      if (toKey === undefined) return null
      return { toVersion, toKey }
    },
  })
