// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { renderChangeDigest, writeGateDigest } from '../../sdd-runner/src/gate-render.js'

describe('gate-render module surface', () => {
  it('renderChangeDigest returns the 5-tuple with placeholders for null fields', () => {
    const lines = renderChangeDigest({ what: null, why: null, touches: null, hasTasks: false }, 'final', false)
    expect(lines).toContain('### Change digest')
    expect(lines.some((l) => l.startsWith('- **WHAT**:'))).toBe(true)
  })

  it('writeGateDigest produces a gate MD with a version marker and resume command', () => {
    const md = writeGateDigest({
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [],
      blockers: [],
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
      summary: 'add a thing',
      costUsd: 0,
      costKnown: false,
      durationMs: 0,
      changeDigest: { what: null, why: null, touches: null, hasTasks: false },
    })
    expect(md).toContain('<!-- gate-1.md -->')
    expect(md).toContain('gate resume run-1')
  })
})
