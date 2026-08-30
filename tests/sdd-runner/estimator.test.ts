// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { DepthSignals } from '../../sdd-runner/src/agent-layer.js'
import {
  buildEstimatorPrompt,
  computeOversize,
  mapSignalsToProfile,
  resolveDepth,
} from '../../sdd-runner/src/estimator.js'

const SIGNALS: DepthSignals = {
  cross_module: true,
  db_migration: false,
  provider_surface: false,
  credentials: false,
  novelty: 'new-subsystem',
}

const files = (count: number): string[] => Array.from({ length: count }, (_, i) => `src/kb/file-${i}.ts`)

describe('computeOversize (corpus-calibrated conjunction)', () => {
  it('routes the kb shape: new-subsystem + cross-module + 36 files', () => {
    expect(computeOversize(SIGNALS, files(36))).toEqual({
      oversize: true,
      oversizeSignals: { novelty: 'new-subsystem', cross_module: true, implicatedFiles: 36 },
    })
  })

  it('keeps the claude-cli shape single-path: 19 files stays under the 30-file threshold', () => {
    expect(computeOversize(SIGNALS, files(19)).oversize).toBe(false)
    expect(computeOversize(SIGNALS, files(30)).oversize).toBe(true)
  })

  it('keeps any missing signal single-path', () => {
    expect(computeOversize({ ...SIGNALS, novelty: 'existing-modules' }, files(36)).oversize).toBe(false)
    expect(computeOversize({ ...SIGNALS, cross_module: false }, files(36)).oversize).toBe(false)
    expect(computeOversize({ ...SIGNALS, novelty: 'existing-modules', cross_module: false }, files(0)).oversize).toBe(
      false,
    )
  })

  it('records the weighed signals regardless of the verdict', () => {
    const { oversizeSignals } = computeOversize({ ...SIGNALS, novelty: 'existing-modules' }, files(7))
    expect(oversizeSignals).toEqual({ novelty: 'existing-modules', cross_module: true, implicatedFiles: 7 })
  })
})

describe('buildEstimatorPrompt (estimator)', () => {
  it('asks for raw observations, stays read-only, never instructs self-declaration', () => {
    const prompt = buildEstimatorPrompt('build the knowledge base', '/repo')
    expect(prompt).toContain('Do not edit anything')
    expect(prompt).toMatch(/implicated_files/u)
    expect(prompt).not.toMatch(/declares scope too large/u)
    expect(prompt).not.toMatch(/Set oversize/u)
  })
})

describe('mapSignalsToProfile / resolveDepth (estimator)', () => {
  it('maps L signals, cross-module M, and plain S', () => {
    expect(mapSignalsToProfile({ ...SIGNALS, novelty: 'existing-modules' })).toBe('M')
    expect(mapSignalsToProfile({ ...SIGNALS, novelty: 'existing-modules', cross_module: false })).toBe('S')
    expect(mapSignalsToProfile({ ...SIGNALS, db_migration: true })).toBe('L')
  })

  it('escalates to the higher profile and flags two-level disagreements', () => {
    expect(resolveDepth('L', 'S')).toEqual({ profile: 'L', disagreement: true })
    expect(resolveDepth('M', 'S')).toEqual({ profile: 'M', disagreement: false })
    expect(resolveDepth('S', 'M')).toEqual({ profile: 'M', disagreement: false })
  })
})
