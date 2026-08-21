// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { PolicyDecision } from '../../sdd-runner/src/auto-policy.js'
import { renderPreviewBlock } from '../../sdd-runner/src/gate-prelude.js'

describe('renderPreviewBlock', () => {
  it('renders every content line as a > -prefixed blockquote under the preview header', () => {
    const decision: PolicyDecision = {
      rule: 'R1',
      action: 'approve',
      evidenceDigest: 'abc123',
    }
    const block = renderPreviewBlock(decision)
    const lines = block.split('\n').filter((line) => line.trim().length > 0)
    expect(lines[0]).toBe('### Auto-decision preview')
    for (const line of lines.slice(1)) {
      expect(line.startsWith('> ')).toBe(true)
    }
    expect(block).toContain('> rule: R1')
    expect(block).toContain('> decision: approve')
  })

  it('contains no checkbox, ABORT, or leading-arrow line the parser could act on', () => {
    const decision: PolicyDecision = {
      rule: 'none',
      action: 'gate',
      evidenceDigest: 'd',
    }
    const block = renderPreviewBlock(decision)
    expect(/^- \[/mu.test(block)).toBe(false)
    expect(/^\s*ABORT\s*$/mu.test(block)).toBe(false)
    expect(/^→/mu.test(block)).toBe(false)
  })
})
