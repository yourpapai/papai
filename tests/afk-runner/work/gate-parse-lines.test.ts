// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { ExpectedGateContent } from '../../../afk-runner/src/work/gate-model.js'
import {
  emptyParseState,
  expectedBlockerIds,
  expectedItemIds,
  processLine,
} from '../../../afk-runner/src/work/gate-parse-lines.js'

const EXPECTED: ExpectedGateContent = {
  assumptions: [],
  blockers: [
    { id: 'B1', gap: 'B1', evidence: '' },
    { id: 'POLICY-INTEGRITY', gap: 'POLICY-INTEGRITY', evidence: '' },
  ],
  gateMode: 'early',
}

/** Fold response lines through the parse state the way parseGateResponse does. */
function parseLines(lines: readonly string[]): ReturnType<typeof emptyParseState> {
  const state = emptyParseState()
  lines.forEach((line, index) => {
    processLine(
      state,
      line,
      index + 1,
      lines[index - 1] ?? '',
      expectedItemIds(EXPECTED),
      expectedBlockerIds(EXPECTED),
      'early',
    )
  })
  return state
}

describe('arrow answers associate by membership, never by id pattern (F-C2/D3)', () => {
  it('an answer beneath a declared B-prefixed row associates with it', () => {
    const state = parseLines(['B1 no rollback path', '→ ship and track in a follow-up'])
    expect(state.answers).toEqual([{ id: 'B1', answer: 'ship and track in a follow-up' }])
  })

  it('an answer beneath the substituted POLICY-INTEGRITY row associates with it', () => {
    const state = parseLines(['POLICY-INTEGRITY sidecar unparseable', '→ acknowledged'])
    expect(state.answers).toEqual([{ id: 'POLICY-INTEGRITY', answer: 'acknowledged' }])
  })

  it('an arrow beneath a non-blocker line still rejects — membership is the only gate', () => {
    expect(() => parseLines(['evidence: sidecar unparseable', '→ acknowledged'])).toThrow(
      /→ line with no preceding assumption or blocker/u,
    )
  })

  it('an arrow beneath an undeclared id-looking row rejects as unknown-free (no membership)', () => {
    expect(() => parseLines(['B9 never declared', '→ acknowledged'])).toThrow(
      /→ line with no preceding assumption or blocker/u,
    )
  })
})
