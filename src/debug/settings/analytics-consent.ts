// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { grantEligibilityInTx, revokeEligibilityInTx } from '../../analytics/governance/collection-store.js'
import type { PreferenceAppliedInTx } from '../../analytics/governance/preference-store.js'
import { deriveSubjectKeys } from '../../analytics/governance/subject-keys.js'
import type { SubjectIdentity, SubjectKeyrings } from '../../analytics/governance/subject-keys.js'

/**
 * The subject's collection-eligibility ref key for the active governance key
 * version -- the same pseudonym `readCollectionRef` in start-analytics.ts
 * derives when it reads the ref back. Taken from `deriveSubjectKeys` so the
 * route never handles raw keyring material.
 */
export const activeCollectionRefKey = (
  identity: SubjectIdentity,
  keyrings: SubjectKeyrings,
): { refKey: string; keyVersion: string } => {
  const governance = keyrings.governance
  if (governance.kind !== 'available') throw new Error('governance keyring unavailable')
  const keys = deriveSubjectKeys(identity, keyrings)
  const primary =
    keys.collectionRefKeys.find((entry) => entry.keyVersion === governance.activeVersion) ?? keys.collectionRefKeys[0]
  if (primary === undefined) throw new Error('no collection ref key derivable for the subject')
  return { refKey: primary.pseudonym, keyVersion: primary.keyVersion }
}

/**
 * Keeps the subject's collection-eligibility ref in step with the consent the
 * same transaction just recorded. The two settings lanes are what gate the
 * runtime's pseudonymous lanes, so either of them reading `allow` is consent to
 * collect; neither reading `allow` withdraws it. Revocation goes through the
 * existing `revokeEligibilityInTx`, which returns null and writes nothing when
 * no row exists -- a subject who never consented gains no record by declining.
 */
export const collectionEligibilityEffect =
  (
    ref: Readonly<{ refKey: string; keyVersion: string }>,
    at: Readonly<{ policyVersion: number; nowMs: number }>,
  ): PreferenceAppliedInTx =>
  (tx, row) => {
    if (row.localLongitudinal === 'allow' || row.externalPseudonymous === 'allow') {
      // When both lanes consent the local one names the grant: it is the broader
      // retention lane, and the ref it produces is the same either way.
      const lane = row.localLongitudinal === 'allow' ? 'local_longitudinal' : 'external_pseudonymous'
      grantEligibilityInTx(tx, { ...ref, lane, policyVersion: at.policyVersion, nowMs: at.nowMs })
      return
    }
    revokeEligibilityInTx(tx, { refKey: ref.refKey, policyVersion: at.policyVersion, nowMs: at.nowMs })
  }
