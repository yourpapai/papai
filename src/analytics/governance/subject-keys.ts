// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { KeyringState } from '../identity/keyring.js'
import { derivePseudonymsAcrossVersions } from '../identity/pseudonym.js'
import type { VersionedKey, VersionedPseudonym } from '../identity/pseudonym.js'
import { COLLECTION_ELIGIBILITY_DOMAIN } from './collection-store.js'
import type { DeletionTargetSet } from './deletion-target-store.js'
import { DELIVERY_GRANT_DOMAIN } from './grant-store.js'
import { GOVERNANCE_ACTOR_DOMAIN } from './preference-store.js'

export const ANALYTICS_ACTOR_DOMAIN = 'actor:v1'

export type SubjectIdentity = Readonly<{
  platformInstanceId: string
  platformUserId: string
}>

export type SubjectKeyrings = Readonly<{
  analytics: KeyringState
  governance: KeyringState
}>

export type SubjectKeys = Readonly<{
  analyticsActorKeys: readonly VersionedPseudonym[]
  governanceActorKeys: readonly VersionedPseudonym[]
  collectionRefKeys: readonly VersionedPseudonym[]
  grantKeys: readonly VersionedPseudonym[]
}>

export class SubjectKeyringUnavailableError extends Error {
  constructor(ring: 'analytics' | 'governance') {
    super(`subject rights lookup requires an available ${ring} keyring`)
    this.name = 'SubjectKeyringUnavailableError'
  }
}

const versionedKeysOf = (state: KeyringState, ring: 'analytics' | 'governance'): readonly VersionedKey[] => {
  if (state.kind !== 'available') throw new SubjectKeyringUnavailableError(ring)
  return [...state.keys.entries()].map(([keyVersion, key]) => ({ keyVersion, key }))
}

/**
 * All-retained-key subject lookup: derives every retained analytics actor,
 * governance actor, collection-ref, and delivery-grant key version for the
 * authenticated identity, using the analytics and governance keyrings
 * independently. Subject denial, export, and deletion search across active,
 * target-shadow, and retired storage generations with these keys — never the
 * active-only ordinary reader.
 */
export const deriveSubjectKeys = (identity: SubjectIdentity, keyrings: SubjectKeyrings): SubjectKeys => {
  const analyticsKeys = versionedKeysOf(keyrings.analytics, 'analytics')
  const governanceKeys = versionedKeysOf(keyrings.governance, 'governance')
  const components = [identity.platformInstanceId, identity.platformUserId] as const
  return {
    analyticsActorKeys: derivePseudonymsAcrossVersions(analyticsKeys, ANALYTICS_ACTOR_DOMAIN, components),
    governanceActorKeys: derivePseudonymsAcrossVersions(governanceKeys, GOVERNANCE_ACTOR_DOMAIN, components),
    collectionRefKeys: derivePseudonymsAcrossVersions(governanceKeys, COLLECTION_ELIGIBILITY_DOMAIN, components),
    grantKeys: derivePseudonymsAcrossVersions(governanceKeys, DELIVERY_GRANT_DOMAIN, components),
  }
}

export type FlatSubjectKeys = Readonly<{
  analyticsActorKeys: readonly string[]
  governanceActorKeys: readonly string[]
  collectionRefKeys: readonly string[]
  grantKeys: readonly string[]
}>

export const flattenSubjectKeys = (keys: SubjectKeys): FlatSubjectKeys => ({
  analyticsActorKeys: keys.analyticsActorKeys.map((entry) => entry.pseudonym),
  governanceActorKeys: keys.governanceActorKeys.map((entry) => entry.pseudonym),
  collectionRefKeys: keys.collectionRefKeys.map((entry) => entry.pseudonym),
  grantKeys: keys.grantKeys.map((entry) => entry.pseudonym),
})

export const toDeletionTargetSet = (keys: SubjectKeys): DeletionTargetSet => flattenSubjectKeys(keys)
