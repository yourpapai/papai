// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  EXTERNAL_OTHER_TOOL_SLUG,
  KNOWN_TOOL_SLUG_SET,
  KNOWN_TOOL_SLUGS,
} from '../../../src/analytics/generated/tool-slugs.js'

describe('generated tool slugs module', () => {
  test('exports a sorted, duplicate-free slug list covering the set', () => {
    expect(KNOWN_TOOL_SLUGS.length).toBeGreaterThan(0)
    expect(KNOWN_TOOL_SLUG_SET.size).toBe(KNOWN_TOOL_SLUGS.length)
    const sorted = [...KNOWN_TOOL_SLUGS].sort((left, right) => left.localeCompare(right))
    expect([...KNOWN_TOOL_SLUGS]).toEqual(sorted)
    expect(EXTERNAL_OTHER_TOOL_SLUG).toBe('external_other')
  })
})
