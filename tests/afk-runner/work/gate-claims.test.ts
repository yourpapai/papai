// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { claimGateSettle, releaseGateSettle } from '../../../afk-runner/src/work/gate-claims.js'

function tempRunDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'afk-claims-'))
}

describe('attempt-scoped claims (D4)', () => {
  it('self-reclaim passes for the same holder', () => {
    const runDir = tempRunDir()
    expect(claimGateSettle(runDir, 1, 'waiter-A').claimed).toBe(true)
    expect(claimGateSettle(runDir, 1, 'waiter-A')).toEqual({ claimed: true, winner: 'waiter-A' })
  })

  it('release removes the claim for its holder and is idempotent', () => {
    const runDir = tempRunDir()
    claimGateSettle(runDir, 1, 'waiter-A')
    releaseGateSettle(runDir, 1, 'waiter-A')
    expect(fs.existsSync(path.join(runDir, 'gate-1.settle-claim'))).toBe(false)
    releaseGateSettle(runDir, 1, 'waiter-A')
    expect(fs.existsSync(path.join(runDir, 'gate-1.settle-claim'))).toBe(false)
  })

  it('release never removes another holder\u2019s claim', () => {
    const runDir = tempRunDir()
    claimGateSettle(runDir, 1, 'waiter-A')
    releaseGateSettle(runDir, 1, 'waiter-B')
    expect(fs.readFileSync(path.join(runDir, 'gate-1.settle-claim'), 'utf8')).toContain('waiter-A')
  })

  it('after a release the gate is claimable again by anyone', () => {
    const runDir = tempRunDir()
    claimGateSettle(runDir, 1, 'waiter-A')
    releaseGateSettle(runDir, 1, 'waiter-A')
    expect(claimGateSettle(runDir, 1, 'waiter-B')).toEqual({ claimed: true, winner: 'waiter-B' })
  })

  it('a stale legacy expiry-claim stops blocking settles (retired honored-as-held check)', () => {
    const runDir = tempRunDir()
    fs.writeFileSync(path.join(runDir, 'gate-3.expiry-claim'), '2026-08-27T00:00:00.000Z\n')
    const claim = claimGateSettle(runDir, 3, 'waiter-B')
    expect(claim.claimed).toBe(true)
  })
})

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

  it('claims are per gate version', () => {
    const runDir = tempRunDir()
    expect(claimGateSettle(runDir, 1, 'waiter-A').claimed).toBe(true)
    expect(claimGateSettle(runDir, 2, 'waiter-B').claimed).toBe(true)
    expect(claimGateSettle(runDir, 1, 'waiter-C').winner).toBe('waiter-A')
  })

  it('a claim naming a dead waiter pid is stolen by the next claimant', async () => {
    const runDir = tempRunDir()
    const dead = Bun.spawn(['sleep', '30'])
    dead.kill(9)
    await dead.exited
    const deadWinner = `waiter-${dead.pid}`
    fs.writeFileSync(path.join(runDir, 'gate-4.settle-claim'), `${deadWinner}\n`)
    const stolen = claimGateSettle(runDir, 4, 'waiter-B')
    expect(stolen.claimed).toBe(true)
    expect(stolen.winner).toBe('waiter-B')
    expect(fs.readFileSync(path.join(runDir, 'gate-4.settle-claim'), 'utf8')).toContain('waiter-B')
  })

  it('a claim naming a live waiter pid is honored, not stolen', () => {
    const runDir = tempRunDir()
    const liveWinner = `waiter-${process.pid}`
    fs.writeFileSync(path.join(runDir, 'gate-5.settle-claim'), `${liveWinner}\n`)
    const loser = claimGateSettle(runDir, 5, 'waiter-B')
    expect(loser).toEqual({ claimed: false, winner: liveWinner })
  })
})
