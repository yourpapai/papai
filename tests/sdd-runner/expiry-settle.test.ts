// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import { processExpiry } from '../../sdd-runner/src/expiry-settle.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-expiry-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('processExpiry (12.3)', () => {
  const approveDecision = { rule: 'R1' as const, action: 'approve' as const, evidenceDigest: 'deadbeef' }

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

  async function waiterEvents(workDir: string, runId: string): Promise<ReturnType<typeof readEvents>> {
    const state = await loadRunState(workDir, runId)
    return readEvents(path.join(state.runDir, 'events.ndjson'))
  }

  it('a conservative settle branch applies → claimed and settled, with the auto_decision appended after the settle write', async () => {
    const { workDir, runId } = await seedDeadlineRun('2026-01-01T00:00:00.000Z')
    const outcome = await processExpiry(workDir, runId, 10, (): Promise<typeof approveDecision> =>
      Promise.resolve(approveDecision),
    )
    expect(outcome).toBe('claimed-and-settled')
    const events = await waiterEvents(workDir, runId)
    expect(events.at(-1)).toMatchObject({
      type: 'auto_decision',
      rule: 'R1',
      decision: 'approve',
      evidenceDigest: 'deadbeef',
      gateVersion: 1,
    })
  })

  it('no settle branch + first expiry → re-arms once with the flag persisted first, emitting a pending auto_decision', async () => {
    const { workDir, runId } = await seedDeadlineRun('2026-01-01T00:00:00.000Z')
    const outcome = await processExpiry(workDir, runId, 10, (): Promise<null> => Promise.resolve(null))
    expect(outcome).toBe('claimed-rearmed')
    const state = await loadRunState(workDir, runId)
    expect(state.gateDeadlineReArmed).toBe(true)
    expect(state.gateDeadlineAt).not.toBeNull()
    const events = await waiterEvents(workDir, runId)
    expect(events.at(-1)).toMatchObject({ type: 'auto_decision', rule: 'none', decision: 'pending', gateVersion: 1 })
  })

  it('second expiry with no safe decision leaves the gate pending indefinitely, still emitting the pending record', async () => {
    const { workDir, runId } = await seedDeadlineRun('2026-01-01T00:00:00.000Z', true)
    const outcome = await processExpiry(workDir, runId, 10, (): Promise<null> => Promise.resolve(null))
    expect(outcome).toBe('claimed-stay-pending')
    const events = await waiterEvents(workDir, runId)
    expect(events.filter((event) => event.type === 'auto_decision')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'auto_decision', decision: 'pending' })
  })

  it('a loser of the exclusive claim exits without acting and without emitting', async () => {
    const { workDir, runId } = await seedDeadlineRun('2026-01-01T00:00:00.000Z')
    const state = await loadRunState(workDir, runId)
    fs.writeFileSync(path.join(state.runDir, 'gate-1.expiry-claim'), 'other-waiter\n')
    const outcome = await processExpiry(workDir, runId, 10, (): Promise<typeof approveDecision> =>
      Promise.resolve(approveDecision),
    )
    expect(outcome).toBe('lost-claim')
    const events = await waiterEvents(workDir, runId)
    expect(events.every((event) => event.type !== 'auto_decision')).toBe(true)
  })
})
