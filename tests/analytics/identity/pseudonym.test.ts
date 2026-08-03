// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createPseudonym, derivePseudonymsAcrossVersions } from '../../../src/analytics/identity/pseudonym.js'

describe('pseudonym derivation across retained key versions', () => {
  const keyV1 = Buffer.alloc(32, 1)
  const keyV2 = Buffer.alloc(32, 2)

  test('each retained key version yields a distinct versioned pseudonym for the same subject', () => {
    const derived = derivePseudonymsAcrossVersions(
      [
        { keyVersion: 'v1', key: keyV1 },
        { keyVersion: 'v2', key: keyV2 },
      ],
      'actor:v1',
      ['pi-1', 'user-1'],
    )
    expect(derived).toHaveLength(2)
    expect(derived[0]?.keyVersion).toBe('v1')
    expect(derived[1]?.keyVersion).toBe('v2')
    expect(derived[0]?.pseudonym.startsWith('v1.')).toBe(true)
    expect(derived[1]?.pseudonym.startsWith('v2.')).toBe(true)
    expect(derived[0]?.pseudonym).not.toBe(derived[1]?.pseudonym)
  })

  test('per-version derivation matches direct createPseudonym output', () => {
    const direct = createPseudonym({ key: keyV2, keyVersion: 'v2', domain: 'actor:v1', components: ['pi-1', 'user-1'] })
    const derived = derivePseudonymsAcrossVersions([{ keyVersion: 'v2', key: keyV2 }], 'actor:v1', ['pi-1', 'user-1'])
    expect(derived[0]?.pseudonym).toBe(direct)
  })

  test('an empty key set yields no pseudonyms', () => {
    expect(derivePseudonymsAcrossVersions([], 'actor:v1', ['pi-1', 'user-1'])).toEqual([])
  })
})
