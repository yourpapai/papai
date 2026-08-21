// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeAll, afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { claimGateSettlement, formatDeadlineRemaining, reduceStopKey } from '../../sdd-runner/src/tui-signals.js'

describe('calm-stop keys (4.6, D-spec: calm stop)', () => {
  it('q requests a calm stop once and stays calm on repeat', () => {
    const first = reduceStopKey({ interruptions: 0 }, 'q')
    expect(first.action.kind).toBe('calm-stop')
    const again = reduceStopKey(first.state, 'q')
    expect(again.action.kind).toBe('calm-stop')
  })

  it('first Ctrl-C requests a calm stop; second exits 130', () => {
    const first = reduceStopKey({ interruptions: 0 }, 'z')
    expect(first.action.kind).toBe('none')
    const stop = reduceStopKey({ interruptions: 0 }, '\u0003')
    expect(stop.action.kind).toBe('calm-stop')
    expect(stop.state.interruptions).toBe(1)
    const second = reduceStopKey(stop.state, '\u0003')
    expect(second.action.kind).toBe('exit-130')
  })

  it('ordinary keys do nothing', () => {
    const result = reduceStopKey({ interruptions: 0 }, 'a')
    expect(result.action.kind).toBe('none')
    expect(result.state.interruptions).toBe(0)
  })
})

describe('deadline countdown display (4.6)', () => {
  const NOW = Date.parse('2026-01-01T00:10:00.000Z')

  it('formats the remaining time while armed', () => {
    expect(formatDeadlineRemaining('2026-01-01T00:14:32.000Z', NOW)).toBe('4m32s to deadline')
    expect(formatDeadlineRemaining('2026-01-01T00:10:59.000Z', NOW)).toBe('59s to deadline')
  })

  it('null when no deadline is armed; expired once past', () => {
    expect(formatDeadlineRemaining(null, NOW)).toBe(null)
    expect(formatDeadlineRemaining('2026-01-01T00:09:59.000Z', NOW)).toBe('deadline expired')
  })
})

describe('first-writer-wins settle claim (4.6, D10)', () => {
  let runDir: string
  beforeAll(() => {
    runDir = mkdtempSync(path.join(tmpdir(), 'sdd-signals-'))
  })
  afterAll(() => {
    rmSync(runDir, { recursive: true, force: true })
  })

  it('the first writer claims; the second is rejected as already-settled with the winner named', () => {
    const first = claimGateSettlement(runDir, 2, 'tui')
    expect(first.kind).toBe('claimed')
    const second = claimGateSettlement(runDir, 2, 'expiry')
    expect(second).toEqual({ kind: 'lost', writer: 'tui' })
  })

  it('a pre-existing expiry claim beats the TUI write', () => {
    writeFileSync(path.join(runDir, 'gate-1.expiry-claim'), 'expiry 2026-01-01T00:00:00.000Z\n')
    const claim = claimGateSettlement(runDir, 1, 'tui')
    expect(claim).toEqual({ kind: 'lost', writer: 'expiry' })
  })

  it('different gate versions claim independently', () => {
    expect(claimGateSettlement(runDir, 3, 'tui').kind).toBe('claimed')
    expect(claimGateSettlement(runDir, 4, 'expiry').kind).toBe('claimed')
  })
})
