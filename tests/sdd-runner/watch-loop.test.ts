// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { summarizeWatchFrame } from '../../sdd-runner/src/watch-loop.js'

describe('summarizeWatchFrame', () => {
  it('renders a compact one-line summary of a watch frame for the non-TTY fallback', () => {
    const line = summarizeWatchFrame({
      round: { current: 2, cap: 3 },
      stagesActive: 'review',
      slots: 2,
      findings: 4,
    })
    expect(line).toBe('watch: review · round 2/3 · agents 2 · findings 4')
  })
})
