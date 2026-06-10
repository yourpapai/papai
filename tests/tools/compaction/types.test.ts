// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { isCompactedEnvelope } from '../../../src/tools/compaction/types.js'

describe('isCompactedEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    expect(
      isCompactedEnvelope({
        _compacted: true,
        handle: 'res_ab12',
        summary: 'short',
        totalBytes: 40000,
        preview: 'head',
        hint: 'call expand_result',
      }),
    ).toBe(true)
  })

  it('accepts a truncation envelope (summary null)', () => {
    expect(
      isCompactedEnvelope({ _compacted: true, handle: 'res_x', summary: null, totalBytes: 9, preview: 'p', hint: 'h' }),
    ).toBe(true)
  })

  it('rejects non-envelopes', () => {
    expect(isCompactedEnvelope({ ok: true })).toBe(false)
    expect(isCompactedEnvelope(null)).toBe(false)
    expect(isCompactedEnvelope({ _compacted: false })).toBe(false)
  })
})
