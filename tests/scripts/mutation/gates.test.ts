// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { PerFileScore } from '../../../scripts/mutation/baseline.js'
import { resolveChangedFilesGates, resolveErroredGate } from '../../../scripts/mutation/gates.js'
import type { GateInput } from '../../../scripts/mutation/gates.js'
import type { MergedScore } from '../../../scripts/mutation/score-merger.js'

const merged = (score: number, scored = 10): MergedScore => ({
  killed: Math.round(score * scored),
  survived: scored - Math.round(score * scored),
  noCoverage: 0,
  timeout: 0,
  compileError: 0,
  ignored: 0,
  runtimeError: 0,
  pending: 0,
  total: scored,
  scored,
  score,
})

const scored = (sourceFile: string, score: number): PerFileScore => ({ sourceFile, merged: merged(score) })

const gateInput = (perFile: readonly PerFileScore[], over: Partial<GateInput> = {}): GateInput => ({
  merged: merged(1),
  perFile,
  skipped: [],
  errored: [],
  ...over,
})

describe('resolveErroredGate', () => {
  test('passes when nothing errored', () => {
    expect(resolveErroredGate([])).toEqual({ exitCode: 0, message: null })
  })

  test('fails and names every errored file', () => {
    const verdict = resolveErroredGate([
      { sourceFile: 'src/a.ts', error: 'dry run failed' },
      { sourceFile: 'src/b.ts', error: 'missing report' },
    ])
    expect(verdict.exitCode).toBe(1)
    expect(verdict.message).toContain('src/a.ts: dry run failed')
    expect(verdict.message).toContain('src/b.ts: missing report')
  })
})

describe('resolveChangedFilesGates', () => {
  const baseline = { 'src/x.ts': 0.9, 'src/y.ts': 0.9 }

  test('passes when every file meets its floor', () => {
    const verdict = resolveChangedFilesGates({
      result: gateInput([scored('src/x.ts', 0.95), scored('src/y.ts', 0.95)]),
      threshold: 0,
      noRatchet: false,
      baseline,
    })
    expect(verdict).toEqual({ exitCode: 0, message: null })
  })

  /**
   * The whole point of the change, expressed at the gate boundary: a score carried over
   * from an earlier commit is an ordinary `PerFileScore`, so a regression introduced in
   * commit A fails commit B's run even though commit B measured only `src/y.ts`.
   */
  test('fails on a regression whichever run measured it', () => {
    const verdict = resolveChangedFilesGates({
      result: gateInput([scored('src/x.ts', 0.5), scored('src/y.ts', 0.95)]),
      threshold: 0,
      noRatchet: false,
      baseline,
    })
    expect(verdict.exitCode).toBe(1)
    expect(verdict.message).toBe('Mutation ratchet regression: src/x.ts 0.5000 < 0.9000')
  })

  // The errored gate runs FIRST, so an unmeasurable file is never masked by a clean ratchet.
  test('reports an errored file ahead of everything else', () => {
    const verdict = resolveChangedFilesGates({
      result: gateInput([scored('src/x.ts', 0.5)], {
        errored: [{ sourceFile: 'src/z.ts', error: 'boom' }],
      }),
      threshold: 0,
      noRatchet: false,
      baseline,
    })
    expect(verdict.exitCode).toBe(1)
    expect(verdict.message).toContain('src/z.ts: boom')
    expect(verdict.message).not.toContain('ratchet')
  })

  test('reports the aggregate threshold ahead of the ratchet', () => {
    const verdict = resolveChangedFilesGates({
      result: gateInput([scored('src/x.ts', 0.5)], { merged: merged(0.5) }),
      threshold: 0.8,
      noRatchet: false,
      baseline,
    })
    expect(verdict.exitCode).toBe(1)
    expect(verdict.message).toBe('Mutation score 0.5 is below threshold 0.8')
  })

  test('skips the ratchet under --no-ratchet but still fails on errored files', () => {
    const regressed = gateInput([scored('src/x.ts', 0.1)])
    expect(resolveChangedFilesGates({ result: regressed, threshold: 0, noRatchet: true, baseline }).exitCode).toBe(0)

    const errored = gateInput([], { errored: [{ sourceFile: 'src/z.ts', error: 'boom' }] })
    expect(resolveChangedFilesGates({ result: errored, threshold: 0, noRatchet: true, baseline }).exitCode).toBe(1)
  })

  test('treats a file with no baseline entry as missing data, not a regression', () => {
    const verdict = resolveChangedFilesGates({
      result: gateInput([scored('src/brand-new.ts', 0.01)]),
      threshold: 0,
      noRatchet: false,
      baseline,
    })
    expect(verdict.exitCode).toBe(0)
  })

  test('names every regressed file in one message', () => {
    const verdict = resolveChangedFilesGates({
      result: gateInput([scored('src/x.ts', 0.5), scored('src/y.ts', 0.6)]),
      threshold: 0,
      noRatchet: false,
      baseline,
    })
    expect(verdict.message).toBe('Mutation ratchet regression: src/x.ts 0.5000 < 0.9000, src/y.ts 0.6000 < 0.9000')
  })
})
