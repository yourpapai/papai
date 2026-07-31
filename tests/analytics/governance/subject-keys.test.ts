// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  deriveSubjectKeys,
  flattenSubjectKeys,
  SubjectKeyringUnavailableError,
  toDeletionTargetSet,
} from '../../../src/analytics/governance/subject-keys.js'
import { createPseudonym } from '../../../src/analytics/identity/pseudonym.js'

const AKEY_V1 = Buffer.alloc(32, 1)
const AKEY_V2 = Buffer.alloc(32, 2)
const GKEY_V1 = Buffer.alloc(32, 3)
const GKEY_V3 = Buffer.alloc(32, 5)

const keyrings = {
  analytics: {
    kind: 'available',
    activeVersion: 'v2',
    activeKey: AKEY_V2,
    keys: new Map([
      ['v1', AKEY_V1],
      ['v2', AKEY_V2],
    ]),
  },
  governance: {
    kind: 'available',
    activeVersion: 'v3',
    activeKey: GKEY_V3,
    keys: new Map([
      ['v1', GKEY_V1],
      ['v3', GKEY_V3],
    ]),
  },
} as const

const identity = { platformInstanceId: 'pi-1', platformUserId: 'user-a' } as const

describe('subject key derivation', () => {
  test('derives every retained key version independently from both keyrings', () => {
    const keys = deriveSubjectKeys(identity, keyrings)
    expect(keys.analyticsActorKeys.map((entry) => entry.keyVersion).sort()).toEqual(['v1', 'v2'])
    expect(keys.governanceActorKeys.map((entry) => entry.keyVersion).sort()).toEqual(['v1', 'v3'])
    expect(keys.collectionRefKeys.map((entry) => entry.keyVersion).sort()).toEqual(['v1', 'v3'])
    expect(keys.grantKeys.map((entry) => entry.keyVersion).sort()).toEqual(['v1', 'v3'])
    const expectedActor = createPseudonym({
      key: AKEY_V1,
      keyVersion: 'v1',
      domain: 'actor:v1',
      components: ['pi-1', 'user-a'],
    })
    expect(keys.analyticsActorKeys.find((entry) => entry.keyVersion === 'v1')?.pseudonym).toBe(expectedActor)
  })

  test('analytics and governance keyrings are used independently', () => {
    const keys = deriveSubjectKeys(identity, keyrings)
    const analyticsPseudonyms = new Set(keys.analyticsActorKeys.map((entry) => entry.pseudonym as string))
    for (const entry of keys.governanceActorKeys) {
      expect(analyticsPseudonyms.has(entry.pseudonym)).toBe(false)
    }
  })

  test('flattening and target-set conversion expose plain key lists', () => {
    const keys = deriveSubjectKeys(identity, keyrings)
    const flat = flattenSubjectKeys(keys)
    expect(flat.analyticsActorKeys).toHaveLength(2)
    const targets = toDeletionTargetSet(keys)
    expect(targets).toEqual(flat)
  })

  test('unavailable keyrings fail closed', () => {
    expect(() =>
      deriveSubjectKeys(identity, {
        analytics: { kind: 'unavailable' },
        governance: keyrings.governance,
      }),
    ).toThrow(SubjectKeyringUnavailableError)
    expect(() =>
      deriveSubjectKeys(identity, {
        analytics: keyrings.analytics,
        governance: { kind: 'invalid' },
      }),
    ).toThrow(SubjectKeyringUnavailableError)
  })
})
