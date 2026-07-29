// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ANALYTICS_EVENT_REGISTRY_V1, SourceFamilyV1Schema } from '../../src/analytics/registry.js'

describe('analytics registry v1', () => {
  test('SourceFamilyV1 accepts the edit source family', () => {
    expect(SourceFamilyV1Schema.safeParse('edit').success).toBe(true)
  })

  test('maps both edit events to the edit source family', () => {
    expect(ANALYTICS_EVENT_REGISTRY_V1.sourceFamilyMap.get('edit_classified')).toBe('edit')
    expect(ANALYTICS_EVENT_REGISTRY_V1.sourceFamilyMap.get('edit_regen')).toBe('edit')
  })

  test('classifies both edit events as C0 privacy', () => {
    expect(ANALYTICS_EVENT_REGISTRY_V1.privacyClassMap.get('edit_classified')).toBe('C0')
    expect(ANALYTICS_EVENT_REGISTRY_V1.privacyClassMap.get('edit_regen')).toBe('C0')
  })
})
