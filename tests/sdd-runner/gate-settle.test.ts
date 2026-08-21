// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { PolicyDecision } from '../../sdd-runner/src/auto-policy.js'
import type { GateAssumption } from '../../sdd-runner/src/gate-model.js'
import { renderAutoApproveAnswers } from '../../sdd-runner/src/gate-settle.js'

describe('renderAutoApproveAnswers', () => {
  const decision: PolicyDecision = {
    rule: 'R1',
    action: 'approve',
    evidenceDigest: 'd',
  }

  it('renders an approved answer section with policy attribution on every line', () => {
    const assumptions: GateAssumption[] = [
      { id: 'A1', text: 'first', blast_radius: 'b', evidence: { files: ['a.md'] } },
      { id: 'A2', text: 'second', blast_radius: 'b', evidence: { files: ['b.md'] } },
    ]
    const md = renderAutoApproveAnswers(decision, assumptions)
    expect(md).toContain('## Gate response')
    expect(md).toContain('decided-by: policy R1')
    expect(md).toContain('- [x] A1 first · decided-by: policy R1')
    expect(md).toContain('- [x] A2 second · decided-by: policy R1')
  })
})
