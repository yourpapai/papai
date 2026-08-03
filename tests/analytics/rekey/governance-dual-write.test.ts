// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setEligibilityState } from '../../../src/analytics/governance/collection-store.js'
import { openDeletionTargets } from '../../../src/analytics/governance/deletion-target-store.js'
import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import { setGrantState } from '../../../src/analytics/governance/grant-store.js'
import { getPreference, setPreference, withdrawPreference } from '../../../src/analytics/governance/preference-store.js'
import { createSnapshotInvalidator } from '../../../src/analytics/governance/snapshot-invalidator.js'
import { deriveSubjectKeys, flattenSubjectKeys } from '../../../src/analytics/governance/subject-keys.js'
import { requestSubjectDeletion } from '../../../src/analytics/governance/subject-service.js'
import { parseGovernanceKeyring } from '../../../src/analytics/identity/keyring.js'
import type { KeyringState } from '../../../src/analytics/identity/keyring.js'
import { deriveRekeyedPseudonym } from '../../../src/analytics/identity/pseudonym.js'
import { createGovernanceDualWriteResolver } from '../../../src/analytics/rekey/governance-dual-write.js'
import { insertMappingPairIn } from '../../../src/analytics/rekey/mapping-store.js'
import { checkpointRekeyRunIn } from '../../../src/analytics/rekey/run-store.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { GOV_KEY_V1, GOV_KEY_V2, NOW, SOURCE_GEN, TARGET_GEN } from './fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const RUN_ID = 'run-1'

const mustKeyring = (value: string): Extract<KeyringState, { kind: 'available' }> => {
  const keyring = parseGovernanceKeyring(value)
  if (keyring.kind !== 'available') throw new Error('keyring unavailable')
  return keyring
}

const mustFirstKey = (keys: readonly string[]): string => {
  const first = keys[0]
  if (first === undefined) throw new Error('no subject key derived')
  return first
}

const armRun = (db: Db): void => {
  planRekeyRun(
    {
      runId: RUN_ID,
      sourceGeneration: SOURCE_GEN,
      targetGeneration: TARGET_GEN,
      fromVersions: ['v1'],
      toVersions: ['v2'],
      sourceHighWater: 'hw-1',
      planHash: 'plan-hash',
      nowMs: NOW,
    },
    { getDrizzleDb: () => db },
  )
  db.transaction((tx) => {
    checkpointRekeyRunIn(tx, {
      runId: RUN_ID,
      phase: 'dual_write',
      subphase: 'dual_write.governance',
      status: 'running',
      nowMs: NOW,
    })
  })
}

const resolver = createGovernanceDualWriteResolver({
  getGovernanceKey: () => ({ toVersion: 'v2', toKey: GOV_KEY_V2 }),
})

const govKeyFor = (oldKey: string): string =>
  deriveRekeyedPseudonym({ key: GOV_KEY_V2, keyVersion: 'v2', domain: 'governance-actor:v1', sourcePseudonym: oldKey })

describe('governance dual-write seams', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('preference mutation mirrors to the target key version atomically while armed', () => {
    armRun(db)
    setPreference(
      {
        governanceActorKey: 'v1.p-gov-actor',
        keyVersion: 'v1',
        lane: 'external_pseudonymous',
        value: 'deny',
        policyVersion: 1,
        source: 'settings',
        nowMs: NOW,
      },
      { getDrizzleDb: () => db, dualWriteResolver: resolver },
    )
    const oldRow = getPreference('v1.p-gov-actor', { getDrizzleDb: () => db })
    const newRow = getPreference(govKeyFor('v1.p-gov-actor'), { getDrizzleDb: () => db })
    expect(oldRow?.externalPseudonymous).toBe('deny')
    expect(newRow?.externalPseudonymous).toBe('deny')
    expect(newRow?.keyVersion).toBe('v2')
    expect(newRow?.localLongitudinal).toBe(oldRow?.localLongitudinal)
  })

  test('withdrawal mirrors a deny onto the target key version and keeps the old deny binding', () => {
    armRun(db)
    withdrawPreference(
      {
        governanceActorKey: 'v1.p-gov-actor',
        keyVersion: 'v1',
        policyVersion: 1,
        source: 'authenticated_request',
        nowMs: NOW,
      },
      { getDrizzleDb: () => db, dualWriteResolver: resolver },
    )
    expect(getPreference('v1.p-gov-actor', { getDrizzleDb: () => db })?.localLongitudinal).toBe('deny')
    expect(getPreference(govKeyFor('v1.p-gov-actor'), { getDrizzleDb: () => db })?.externalPseudonymous).toBe('deny')
  })

  test('preference mutation writes one row when no run is armed', () => {
    setPreference(
      {
        governanceActorKey: 'v1.p-gov-actor',
        keyVersion: 'v1',
        lane: 'local_longitudinal',
        value: 'allow',
        policyVersion: 1,
        source: 'settings',
        nowMs: NOW,
      },
      { getDrizzleDb: () => db, dualWriteResolver: resolver },
    )
    expect(getPreference(govKeyFor('v1.p-gov-actor'), { getDrizzleDb: () => db })).toBeNull()
  })

  test('collection eligibility deny mirrors with the same generation and keeps the old deny binding', () => {
    armRun(db)
    setEligibilityState(
      { refKey: 'v1.p-colref', keyVersion: 'v1', state: 'allow', policyVersion: 1, nowMs: NOW },
      { getDrizzleDb: () => db, dualWriteResolver: resolver },
    )
    setEligibilityState(
      { refKey: 'v1.p-colref', keyVersion: 'v1', state: 'deny', policyVersion: 1, nowMs: NOW + 1 },
      { getDrizzleDb: () => db, dualWriteResolver: resolver },
    )
    const newRefKey = deriveRekeyedPseudonym({
      key: GOV_KEY_V2,
      keyVersion: 'v2',
      domain: 'collection-eligibility:v1',
      sourcePseudonym: 'v1.p-colref',
    })
    const rows = db.$client
      .query<{ ref_key: string; state: string; generation: number }, []>(
        `SELECT ref_key, state, generation FROM analytics_collection_eligibility ORDER BY ref_key`,
      )
      .all()
    const oldRow = rows.find((row) => row.ref_key === 'v1.p-colref')
    const newRow = rows.find((row) => row.ref_key === newRefKey)
    expect(oldRow?.state).toBe('deny')
    expect(newRow?.state).toBe('deny')
    expect(newRow?.generation).toBe(oldRow?.generation)
  })

  test('delivery grant mutation mirrors to the target grant key', () => {
    armRun(db)
    setGrantState(
      { grantKey: 'v1.p-grant', keyVersion: 'v1', state: 'deny', policyVersion: 1, nowMs: NOW },
      { getDrizzleDb: () => db, dualWriteResolver: resolver },
    )
    const newGrantKey = deriveRekeyedPseudonym({
      key: GOV_KEY_V2,
      keyVersion: 'v2',
      domain: 'delivery-grant:v1',
      sourcePseudonym: 'v1.p-grant',
    })
    const newRow = db.$client
      .query<{ state: string; key_version: string }, [string]>(
        `SELECT state, key_version FROM analytics_eligibility_grants WHERE grant_key = ?`,
      )
      .get(newGrantKey)
    expect(newRow?.state).toBe('deny')
    expect(newRow?.key_version).toBe('v2')
  })

  test('subject deletion targets expand through retained encrypted mappings', () => {
    const keyring = mustKeyring(`v1:${GOV_KEY_V1.toString('hex')};v2:${GOV_KEY_V2.toString('hex')}`)
    const identity = { platformInstanceId: 'pi-1', platformUserId: 'pu-1' }
    planRekeyRun(
      {
        runId: RUN_ID,
        sourceGeneration: SOURCE_GEN,
        targetGeneration: TARGET_GEN,
        fromVersions: ['v1'],
        toVersions: ['v2'],
        sourceHighWater: 'hw-1',
        planHash: 'plan-hash',
        nowMs: NOW,
      },
      { getDrizzleDb: () => db },
    )
    const keys = flattenSubjectKeys(deriveSubjectKeys(identity, { analytics: keyring, governance: keyring }))
    db.transaction((tx) => {
      for (const oldKey of keys.governanceActorKeys) {
        insertMappingPairIn(tx, {
          runId: RUN_ID,
          domain: 'governance-actor:v1',
          oldKey,
          newKey: deriveRekeyedPseudonym({
            key: GOV_KEY_V2,
            keyVersion: 'v2',
            domain: 'governance-actor:v1',
            sourcePseudonym: oldKey,
          }),
          encryptionKey: GOV_KEY_V1,
        })
      }
    })
    const result = requestSubjectDeletion(
      identity,
      {
        getDrizzleDb: () => db,
        keyrings: { analytics: keyring, governance: keyring },
        snapshotInvalidator: createSnapshotInvalidator({ getDrizzleDb: () => db }),
      },
      NOW,
    )
    const targets = openDeletionTargets(
      { requestId: result.requestId, encryptionKeys: [GOV_KEY_V2, GOV_KEY_V1] },
      { getDrizzleDb: () => db },
    )
    const expectedRekeyed = deriveRekeyedPseudonym({
      key: GOV_KEY_V2,
      keyVersion: 'v2',
      domain: 'governance-actor:v1',
      sourcePseudonym: mustFirstKey(keys.governanceActorKeys),
    })
    expect(targets?.governanceActorKeys).toContain(expectedRekeyed)
  })
})
