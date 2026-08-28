// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { claimGateSettle } from '../../../afk-runner/src/work/gate-claims.js'

function tempRunDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'afk-claims-'))
}

describe('first-writer-wins settle claims', () => {
  it('the first claimant exclusively creates gate-<n>.settle-claim and wins', () => {
    const runDir = tempRunDir()
    const first = claimGateSettle(runDir, 1, 'waiter-A')
    expect(first).toEqual({ claimed: true, winner: 'waiter-A' })
    expect(fs.existsSync(path.join(runDir, 'gate-1.settle-claim'))).toBe(true)
  })

  it('the loser is rejected as already-settled with the winner named', () => {
    const runDir = tempRunDir()
    expect(claimGateSettle(runDir, 2, 'waiter-A').claimed).toBe(true)
    const loser = claimGateSettle(runDir, 2, 'waiter-B')
    expect(loser).toEqual({ claimed: false, winner: 'waiter-A' })
    const content = fs.readFileSync(path.join(runDir, 'gate-2.settle-claim'), 'utf8')
    expect(content).toContain('waiter-A')
  })

  it('a legacy gate-<n>.expiry-claim counts as a held claim', () => {
    const runDir = tempRunDir()
    fs.writeFileSync(path.join(runDir, 'gate-3.expiry-claim'), '2026-08-27T00:00:00.000Z\n')
    const loser = claimGateSettle(runDir, 3, 'waiter-B')
    expect(loser.claimed).toBe(false)
    expect(loser.winner).toBe('2026-08-27T00:00:00.000Z')
  })

  it('claims are per gate version', () => {
    const runDir = tempRunDir()
    expect(claimGateSettle(runDir, 1, 'waiter-A').claimed).toBe(true)
    expect(claimGateSettle(runDir, 2, 'waiter-B').claimed).toBe(true)
    expect(claimGateSettle(runDir, 1, 'waiter-C').winner).toBe('waiter-A')
  })
})
