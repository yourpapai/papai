// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { EXPAND_MAX_OFFSET_CHARS } from '../../../src/tools/compaction/constants.js'
import { makeExpandResultTool } from '../../../src/tools/compaction/expand-result.js'
import { schemaValidates } from '../../utils/test-helpers.js'

describe('expand_result offset bound', () => {
  it('accepts an offset at the maximum', () => {
    const t = makeExpandResultTool('ctx-1')
    expect(schemaValidates(t, { handle: 'res_ab12', offset: EXPAND_MAX_OFFSET_CHARS })).toBe(true)
  })

  it('rejects an offset above the maximum', () => {
    const t = makeExpandResultTool('ctx-1')
    expect(schemaValidates(t, { handle: 'res_ab12', offset: EXPAND_MAX_OFFSET_CHARS + 1 })).toBe(false)
  })

  it('does not leave the offset schema unbounded at MAX_SAFE_INTEGER', () => {
    expect(EXPAND_MAX_OFFSET_CHARS).toBeLessThan(Number.MAX_SAFE_INTEGER)
    expect(EXPAND_MAX_OFFSET_CHARS).toBeGreaterThan(0)
  })
})
