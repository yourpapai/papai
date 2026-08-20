// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  digestOf,
  isStableEdit,
  looksAnswered,
  processExpiry,
  shouldEnterWaiter,
  translateSteer,
} from '../../sdd-runner/src/deadline-waiter.js'
import { appendEvent } from '../../sdd-runner/src/events.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-waiter-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('shouldEnterWaiter (12.2)', () => {
  it('defaults to wait only on a non-TTY flagless deadline-pending gate', () => {
    expect(
      shouldEnterWaiter({
        isTty: false,
        deadlineAt: '2026-01-01T00:00:00.000Z',
        hasDecisionFlags: false,
        noWait: false,
      }),
    ).toBe(true)
  })

  it('TTY flagless keeps the interactive path; --no-wait forces immediate; flags never wait', () => {
    expect(
      shouldEnterWaiter({
        isTty: true,
        deadlineAt: '2026-01-01T00:00:00.000Z',
        hasDecisionFlags: false,
        noWait: false,
      }),
    ).toBe(false)
    expect(
      shouldEnterWaiter({
        isTty: false,
        deadlineAt: '2026-01-01T00:00:00.000Z',
        hasDecisionFlags: false,
        noWait: true,
      }),
    ).toBe(false)
    expect(
      shouldEnterWaiter({
        isTty: false,
        deadlineAt: '2026-01-01T00:00:00.000Z',
        hasDecisionFlags: true,
        noWait: false,
      }),
    ).toBe(false)
  })

  it('no pending deadline never waits', () => {
    expect(shouldEnterWaiter({ isTty: false, deadlineAt: null, hasDecisionFlags: false, noWait: false })).toBe(false)
  })
})

describe('hand-edit stability (12.2)', () => {
  it('settles only after the content hash is unchanged for 3 consecutive ticks', () => {
    const md = '## Gate response\n\n- [x] A1 ok\n'
    expect(isStableEdit([digestOf(md), digestOf(md), digestOf(md)])).toBe(true)
    expect(isStableEdit([digestOf('draft'), digestOf(md), digestOf(md)])).toBe(false)
    expect(isStableEdit([digestOf(md), digestOf(md)])).toBe(false)
  })

  it('looksAnswered detects a checked box or an answer section', () => {
    expect(looksAnswered('- [x] A1 ok')).toBe(true)
    expect(looksAnswered('## Gate response\n')).toBe(true)
    expect(looksAnswered('- [ ] A1 unresolved')).toBe(false)
  })
})

describe('steer translation (12.2)', () => {
  it('extend lands at an early gate but warns and skips at a final gate', () => {
    expect(translateSteer({ kind: 'extend' }, 'early').warn).toBeNull()
    expect(translateSteer({ kind: 'extend' }, 'final').warn).toMatch(/not valid at a final gate/u)
  })
})

describe('processExpiry (12.3)', () => {
  async function seedDeadlineRun(deadlineAt: string, reArmed = false): Promise<{ workDir: string; runId: string }> {
    const workDir = path.join(makeDir(), '.sdd-runner')
    const state = await createRunState({ workDir, repoRoot: workDir, changeName: 'thing' })
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    state.gate = { mode: 'final', version: 1 }
    state.stage = 'gate'
    state.gateDeadlineAt = deadlineAt
    state.gateDeadlineReArmed = reArmed
    await saveRunState(state)
    appendEvent(path.join(state.runDir, 'events.ndjson'), {
      altitude: 'L2',
      type: 'gate',
      action: 'presented',
      mode: 'final',
      version: 1,
    })
    return { workDir, runId: state.runId }
  }

  it('a conservative settle branch applies → claimed and settled', async () => {
    const { workDir, runId } = await seedDeadlineRun('2026-01-01T00:00:00.000Z')
    const outcome = await processExpiry(workDir, runId, 10, (): Promise<boolean> => Promise.resolve(true))
    expect(outcome).toBe('claimed-and-settled')
  })

  it('no settle branch + first expiry → re-arms once with the flag persisted first', async () => {
    const { workDir, runId } = await seedDeadlineRun('2026-01-01T00:00:00.000Z')
    const outcome = await processExpiry(workDir, runId, 10, (): Promise<boolean> => Promise.resolve(false))
    expect(outcome).toBe('claimed-rearmed')
    const state = await loadRunState(workDir, runId)
    expect(state.gateDeadlineReArmed).toBe(true)
    expect(state.gateDeadlineAt).not.toBeNull()
  })

  it('second expiry with no safe decision leaves the gate pending indefinitely', async () => {
    const { workDir, runId } = await seedDeadlineRun('2026-01-01T00:00:00.000Z', true)
    const outcome = await processExpiry(workDir, runId, 10, (): Promise<boolean> => Promise.resolve(false))
    expect(outcome).toBe('claimed-stay-pending')
  })

  it('a loser of the exclusive claim exits without acting', async () => {
    const { workDir, runId } = await seedDeadlineRun('2026-01-01T00:00:00.000Z')
    const state = await loadRunState(workDir, runId)
    fs.writeFileSync(path.join(state.runDir, 'gate-1.expiry-claim'), 'other-waiter\n')
    const outcome = await processExpiry(workDir, runId, 10, (): Promise<boolean> => Promise.resolve(true))
    expect(outcome).toBe('lost-claim')
  })
})
