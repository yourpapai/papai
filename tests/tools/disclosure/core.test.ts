// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  CORE_TOOL_NAMES,
  META_TOOL_NAMES,
  ALWAYS_ON_TOOL_NAMES,
  DISCLOSURE_STALL_STEPS,
} from '../../../src/tools/disclosure/core.js'

describe('disclosure core constants', () => {
  it('keeps get_current_time as the only domain-essential core', () => {
    expect([...CORE_TOOL_NAMES]).toEqual(['get_current_time'])
  })

  it('exposes the three meta tools', () => {
    expect([...META_TOOL_NAMES].toSorted()).toEqual(['expand_result', 'load_tool', 'search_tools'])
  })

  it('ALWAYS_ON is the union of core and meta', () => {
    expect(ALWAYS_ON_TOOL_NAMES.has('get_current_time')).toBe(true)
    expect(ALWAYS_ON_TOOL_NAMES.has('search_tools')).toBe(true)
    expect([...ALWAYS_ON_TOOL_NAMES].toSorted()).toEqual([
      'expand_result',
      'get_current_time',
      'load_tool',
      'search_tools',
    ])
  })

  it('uses a small positive stall threshold', () => {
    expect(DISCLOSURE_STALL_STEPS).toBe(2)
  })
})
