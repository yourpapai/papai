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
  shouldEnterWaiter,
  translateSteer,
} from '../../sdd-runner/src/deadline-waiter.js'
import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import type { RunGateResumeResult } from '../../sdd-runner/src/extend-round.js'
import { looksAnswered } from '../../sdd-runner/src/gate-answered.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { runPolicyLadder } from '../../sdd-runner/src/gate-prelude.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

interface GateResumeOptionsRecord {
  readonly abort?: boolean
  readonly confirmAll?: boolean
  readonly extend?: boolean
  readonly noWait?: boolean
  readonly vetoes?: readonly { readonly id: string; readonly redirect?: string }[]
}

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

describe('expiry ladder parity with R4 (sdd-policy-metered-budget 4.x)', () => {
  const autoDecisionKinds = (events: ReturnType<typeof readEvents>): readonly string[] =>
    events.flatMap((event) => (event.type === 'auto_decision' ? [event.decision] : []))
  const MATERIAL_RESOLUTION = {
    id: 'F1',
    class: 'MATERIAL' as const,
    resolution: 'assumed' as const,
    outcome: 'kept',
  }

  async function seedExpiredEarlyGate(
    autonomy: NonNullable<OrchestratorDeps['autonomy']>,
    materialCounts: readonly number[],
  ): Promise<{ deps: OrchestratorDeps; state: RunState; stdout: string[] }> {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    const stdout: string[] = []
    const state = await createRunState({ workDir, repoRoot, changeName: 'thing' })
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    state.gate = { mode: 'early', version: 1 }
    state.stage = 'gate'
    state.round = materialCounts.length
    state.gateDeadlineAt = '2026-01-01T00:00:00.000Z'
    await saveRunState(state)
    fs.writeFileSync(
      path.join(state.runDir, 'sidecars', `resolutions-${materialCounts.length}.json`),
      JSON.stringify({ resolutions: [MATERIAL_RESOLUTION], assumptions: [] }),
    )
    const logPath = path.join(state.runDir, 'events.ndjson')
    appendEvent(logPath, {
      altitude: 'L2',
      type: 'gate',
      action: 'presented',
      mode: 'early',
      version: 1,
    })
    appendEvent(logPath, {
      altitude: 'L1',
      type: 'done',
      agent: 'reviewer-r1',
      model: 'zai-coding-plan/glm-4.7',
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        reasoningTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        costUsd: 0,
        wallMs: 60_000,
      },
    })
    materialCounts.forEach((total, i) => {
      appendEvent(logPath, {
        altitude: 'L2',
        type: 'convergence',
        round: i + 1,
        verdict: 'open',
        counts: { blocker: 0, material: total, nitpick: 0 },
      })
    })
    const deps: OrchestratorDeps = {
      config: { repoRoot, workDir, model: 'test-model', budget: null },
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
      autonomy,
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

  it('an unmetered expiry settles the real early gate through the extend flag and records the R2 decision', async () => {
    const { deps, state } = await seedExpiredEarlyGate(
      { level: 'assist', costCeilingUsd: null, metered: false },
      [3, 2, 1],
    )
    const calls: GateResumeOptionsRecord[] = []
    const result = await awaitGateDeadline(deps, state.runId, recordingResume(calls))
    expect(result.outcome).toBe('approved')
    expect(calls).toEqual([{ extend: true }])
    const events = readEvents(path.join(state.runDir, 'events.ndjson'))
    expect(events.at(-1)).toMatchObject({ type: 'auto_decision', rule: 'R2', decision: 'extend', gateVersion: 1 })
    const prelude = runPolicyLadder(
      deps,
      state,
      {
        cwd: deps.config.repoRoot,
        changeDir: path.join(deps.config.repoRoot, 'openspec', 'changes', state.changeName),
        sidecarDir: path.join(state.runDir, 'sidecars'),
        emit: (): void => undefined,
      },
      {
        outcome: 'cap-hit',
        rounds: 3,
        openBlockers: [],
        openMaterial: [MATERIAL_RESOLUTION],
        openNitpicks: [],
      },
      {
        mode: 'early',
        version: 1,
        events: [],
        costUsd: 0,
        costKnown: false,
        assumptions: [],
        trajectory: [
          { round: 1, counts: { blocker: 0, material: 3, nitpick: 0 }, resolved: 0, dismissed: 0, verdict: 'open' },
          { round: 2, counts: { blocker: 0, material: 2, nitpick: 0 }, resolved: 0, dismissed: 0, verdict: 'open' },
          { round: 3, counts: { blocker: 0, material: 1, nitpick: 0 }, resolved: 0, dismissed: 0, verdict: 'open' },
        ],
      },
    )
    expect(prelude.decision).toMatchObject({ rule: 'R2', action: 'extend' })
  }, 10_000)

  it('a metered run with unknown cost stays pending at expiry (re-arm, no settle)', async () => {
    const { deps, state, stdout } = await seedExpiredEarlyGate(
      { level: 'assist', costCeilingUsd: 5, metered: true },
      [3, 2, 1],
    )
    const calls: GateResumeOptionsRecord[] = []
    const settle = setTimeout(() => {
      fs.writeFileSync(path.join(state.runDir, 'gate-1.md'), '## Gate response\n\n- [x] F1 ok\n')
    }, 2_500)
    try {
      await awaitGateDeadline(deps, state.runId, recordingResume(calls))
    } finally {
      clearTimeout(settle)
    }
    expect(calls).toEqual([{ noWait: true }])
    expect(stdout.some((line) => line.includes('gate stays pending'))).toBe(true)
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.gateDeadlineReArmed).toBe(true)
    const kinds = autoDecisionKinds(readEvents(path.join(state.runDir, 'events.ndjson')))
    expect(kinds).toContain('pending')
    expect(kinds).not.toContain('extend')
  }, 20_000)
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
