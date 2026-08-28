// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  awaitGateDeadline,
  digestOf,
  isStableEdit,
  processExpiry,
  shouldEnterWaiter,
  translateSteer,
} from '../../sdd-runner/src/deadline-waiter.js'
import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import type { RunGateResumeResult } from '../../sdd-runner/src/extend-round.js'
import { looksAnswered } from '../../sdd-runner/src/gate-answered.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

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

  it('looksAnswered recognizes a hand-checked plan-gate child row', () => {
    expect(looksAnswered('- [x] C1 db-schema — Rename the schema columns.')).toBe(true)
    expect(looksAnswered('- [ ] C1 db-schema — Rename the schema columns.')).toBe(false)
  })
})

describe('steer translation (12.2)', () => {
  it('extend lands at an early gate but warns and skips at a final gate', () => {
    expect(translateSteer({ kind: 'extend' }, 'early').warn).toBeNull()
    expect(translateSteer({ kind: 'extend' }, 'final').warn).toMatch(/not valid at a final gate/u)
  })

  it('extend warns and skips at a plan gate too (cap-hit only)', () => {
    expect(translateSteer({ kind: 'extend' }, 'plan').warn).toMatch(/not valid at a plan gate/u)
    expect(translateSteer({ kind: 'abort' }, 'plan').warn).toBeNull()
  })
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

describe('plan-mode gates under the waiter', () => {
  async function seedPlanGate(
    deadlineAt: string | null,
  ): Promise<{ deps: OrchestratorDeps; state: RunState; stdout: string[] }> {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    const stdout: string[] = []
    const state = await createRunState({ workDir, repoRoot, changeName: 'composite' })
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    state.gate = { mode: 'plan', version: 1 }
    state.plan = { childIds: ['db-schema', 'db-api'], digest: 'd'.repeat(16) }
    state.children = { 'db-schema': { status: 'pending' }, 'db-api': { status: 'pending' } }
    state.gateDeadlineAt = deadlineAt
    await saveRunState(state)
    appendEvent(path.join(state.runDir, 'events.ndjson'), {
      altitude: 'L2',
      type: 'gate',
      action: 'presented',
      mode: 'plan',
      version: 1,
    })
    fs.writeFileSync(
      path.join(state.runDir, 'gate-1.md'),
      ['## Plan gate — change composite', '', '- [ ] C1 db-schema — Rename the schema columns.', ''].join('\n'),
    )
    const deps: OrchestratorDeps = {
      config: { repoRoot, workDir, model: 'test-model', budget: 5 },
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: createOpenSpecDriver({
        exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
        cwd: repoRoot,
      }),
      resolveCost: () => null,
      stdout: (line: string): void => {
        stdout.push(line)
      },
    }
    return { deps, state, stdout }
  }

  function recordingResume(
    calls: GateResumeOptionsRecord[],
  ): (deps: OrchestratorDeps, runId: string, options: GateResumeOptionsRecord) => Promise<RunGateResumeResult> {
    return (_deps, runId, options) => {
      calls.push(options)
      return Promise.resolve({ runId, outcome: 'approved' as const, version: 1 })
    }
  }

  interface GateResumeOptionsRecord {
    readonly abort?: boolean
    readonly confirmAll?: boolean
    readonly extend?: boolean
    readonly noWait?: boolean
    readonly vetoes?: readonly { readonly id: string; readonly redirect?: string }[]
  }

  it('a steer abort at a plan gate resumes through the abort flag instead of throwing', async () => {
    const { deps, state } = await seedPlanGate('2999-01-01T00:00:00.000Z')
    fs.writeFileSync(path.join(state.runDir, 'steer.md'), 'abort\n')
    const calls: GateResumeOptionsRecord[] = []
    const result = await awaitGateDeadline(deps, state.runId, recordingResume(calls))
    expect(result.outcome).toBe('approved')
    expect(calls).toEqual([{ abort: true }])
    expect(fs.existsSync(path.join(state.runDir, 'steer.md'))).toBe(false)
  }, 15_000)

  it('an expired plan gate stays pending, an extend steer is skipped, and a hand-checked C row settles it', async () => {
    const { deps, state, stdout } = await seedPlanGate('2026-01-01T00:00:00.000Z')
    fs.writeFileSync(path.join(state.runDir, 'steer.md'), 'extend\n')
    const handEdit = setTimeout(() => {
      fs.writeFileSync(
        path.join(state.runDir, 'gate-1.md'),
        ['## Plan gate — change composite', '', '- [x] C1 db-schema — Rename the schema columns.', ''].join('\n'),
      )
    }, 1_500)
    const calls: GateResumeOptionsRecord[] = []
    try {
      const result = await awaitGateDeadline(deps, state.runId, recordingResume(calls))
      expect(result.outcome).toBe('approved')
    } finally {
      clearTimeout(handEdit)
    }
    expect(calls).toEqual([{ noWait: true }])
    expect(stdout.some((line) => line.includes('extend is not valid at a plan gate'))).toBe(true)
    expect(stdout.some((line) => line.includes('gate stays pending'))).toBe(true)
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.gateDeadlineReArmed).toBe(true)
    const events = readEvents(path.join(state.runDir, 'events.ndjson'))
    const autoDecisions = events.filter((event) => event.type === 'auto_decision')
    expect(autoDecisions).toHaveLength(1)
    expect(autoDecisions[0]).toMatchObject({ rule: 'none', decision: 'pending' })
  }, 20_000)

  it('a hand-edited full veto (→ redirect under an unchecked child) settles the deadline-waited plan gate', async () => {
    const { deps, state } = await seedPlanGate('2999-01-01T00:00:00.000Z')
    const handEdit = setTimeout(() => {
      fs.writeFileSync(
        path.join(state.runDir, 'gate-1.md'),
        [
          '## Plan gate — change composite',
          '',
          '- [ ] C1 db-schema — Rename the schema columns.',
          '→ split the schema child',
          '',
        ].join('\n'),
      )
    }, 1_500)
    const calls: GateResumeOptionsRecord[] = []
    try {
      const result = await awaitGateDeadline(deps, state.runId, recordingResume(calls))
      expect(result.outcome).toBe('approved')
    } finally {
      clearTimeout(handEdit)
    }
    expect(calls).toEqual([{ noWait: true }])
  }, 15_000)

  it('a hand-written lone ABORT settles the deadline-waited plan gate', async () => {
    const { deps, state } = await seedPlanGate('2999-01-01T00:00:00.000Z')
    const handEdit = setTimeout(() => {
      fs.writeFileSync(
        path.join(state.runDir, 'gate-1.md'),
        [
          '## Plan gate — change composite',
          '',
          '- [ ] C1 db-schema — Rename the schema columns.',
          '',
          'ABORT',
          '',
        ].join('\n'),
      )
    }, 1_500)
    const calls: GateResumeOptionsRecord[] = []
    try {
      const result = await awaitGateDeadline(deps, state.runId, recordingResume(calls))
      expect(result.outcome).toBe('approved')
    } finally {
      clearTimeout(handEdit)
    }
    expect(calls).toEqual([{ noWait: true }])
  }, 15_000)
})
