// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { REKEY_MAPPING_DOMAIN_VALUES } from '../../../src/db/migrations/073_analytics_governance_tables.js'

describe('073_analytics_governance_tables helpers', () => {
  test('rekey mapping domain registry is complete and unique', () => {
    expect(REKEY_MAPPING_DOMAIN_VALUES).toContain('thread:v1')
    expect(REKEY_MAPPING_DOMAIN_VALUES).toContain('governance-actor:v1')
    expect(REKEY_MAPPING_DOMAIN_VALUES).toContain('collection-eligibility:v1')
    expect(REKEY_MAPPING_DOMAIN_VALUES).toContain('delivery-grant:v1')
    expect(new Set(REKEY_MAPPING_DOMAIN_VALUES).size).toBe(REKEY_MAPPING_DOMAIN_VALUES.length)
    expect(REKEY_MAPPING_DOMAIN_VALUES.length).toBe(19)
  })
})
