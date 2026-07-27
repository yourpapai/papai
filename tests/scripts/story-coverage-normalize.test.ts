// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { normalizeLcov } from '../../scripts/coverage/normalize-lcov.js'

describe('normalizeLcov', () => {
  it('strips the /session/app/ container prefix from SF lines', () => {
    const input = ['TN:', 'SF:/session/app/src/tools/registry.ts', 'DA:1,1', 'end_of_record'].join('\n')
    expect(normalizeLcov(input)).toContain('SF:src/tools/registry.ts')
    expect(normalizeLcov(input)).not.toContain('/session/app/')
  })

  it('passes an already-relative SF path through unchanged', () => {
    const input = 'SF:src/index.ts\nDA:1,1\nend_of_record'
    expect(normalizeLcov(input)).toBe(input)
  })

  it('strips a leading ./ prefix', () => {
    expect(normalizeLcov('SF:./src/a.ts')).toBe('SF:src/a.ts')
  })

  it('leaves non-SF lines and non-src prefixes intact', () => {
    const input = 'DA:5,0\nSF:plugins/acp/index.ts\nFNDA:2,foo'
    expect(normalizeLcov(input)).toBe(input)
  })
})
