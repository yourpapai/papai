// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { settleApprovedGate } from '../../sdd-runner/src/extend-round.js'
import { runGateResume } from '../../sdd-runner/src/extend-round.js'
import { prepareResumeInput } from '../../sdd-runner/src/gate-digest.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { scriptedPrompter } from '../../sdd-runner/src/prompter.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'

function makeSidecarDir(): { dir: string; sidecarDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-ext-'))
  const sidecarDir = path.join(dir, 'sidecars')
  fs.mkdirSync(sidecarDir, { recursive: true })
  return { dir, sidecarDir }
}

describe('prepareResumeInput module surface', () => {
  it('reads a converged review result and gathers assumptions from sidecars', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-ext-'))
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(
      path.join(sidecarDir, 'resolutions-2.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'edited', outcome: 'fixed' }],
        assumptions: [
          {
            id: 'A1',
            text: 'ok',
            basis: 'default',
            confidence: 'medium',
            blast_radius: 'low',
            status: 'open',
            evidence: { files: ['openspec/changes/thing/proposal.md'] },
          },
        ],
      }),
    )
    const result = await prepareResumeInput(sidecarDir, 2, 'final')
    expect(result.requiredAck).toBeUndefined()
    expect(result.assumptions.map((a) => a.id)).toContain('A1')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('prepareResumeInput gate-mode semantics', () => {
  it('treats an early gate as a cap-hit and demands the trajectory ack when no blockers are open', async () => {
    const { dir, sidecarDir } = makeSidecarDir()
    fs.writeFileSync(
      path.join(sidecarDir, 'resolutions-2.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'dismissed', justification: 'cosmetic' }],
        assumptions: [],
      }),
    )
    const result = await prepareResumeInput(sidecarDir, 2, 'early')
    expect(result.reviewResult.outcome).toBe('cap-hit')
    expect(result.requiredAck).toBe('T1')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('waives the trajectory ack at an early gate while blockers are still open', async () => {
    const { dir, sidecarDir } = makeSidecarDir()
    fs.writeFileSync(
      path.join(sidecarDir, 'resolutions-2.json'),
      JSON.stringify({
        resolutions: [{ id: 'B1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' }],
        assumptions: [],
      }),
    )
    const result = await prepareResumeInput(sidecarDir, 2, 'early')
    expect(result.reviewResult.outcome).toBe('cap-hit')
    expect(result.requiredAck).toBeUndefined()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('treats a final gate as converged and never demands the trajectory ack', async () => {
    const { dir, sidecarDir } = makeSidecarDir()
    fs.writeFileSync(
      path.join(sidecarDir, 'resolutions-2.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }],
        assumptions: [],
      }),
    )
    const result = await prepareResumeInput(sidecarDir, 2, 'final')
    expect(result.reviewResult.outcome).toBe('converged')
    expect(result.requiredAck).toBeUndefined()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('settleApprovedGate export (7.1)', () => {
  it('finalizes a final-gate approve to completed with no pending gate entry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-settle-'))
    const workDir = path.join(dir, 'work')
    const state = await createRunState({ workDir, repoRoot: dir, changeName: 'thing' })
    state.gate = { mode: 'final', version: 3 }
    state.stage = 'gate'
    const emit = (): void => {}
    const result = await settleApprovedGate(
      {
        deps: {
          config: { repoRoot: dir, workDir, model: 'm', models: {}, timeouts: { wallClockMs: 1, inactivityMs: 1 } },
          spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
          execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
          driver: createOpenSpecDriver({
            exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
            cwd: dir,
          }),
        },
        state,
        emit,
        version: 3,
        changeDir: path.join(dir, 'openspec', 'changes', 'thing'),
        sidecarDir: path.join(state.runDir, 'sidecars'),
        agent: {
          spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
          config: { repoRoot: dir, workDir, model: 'm', models: {}, timeouts: { wallClockMs: 1, inactivityMs: 1 } },
          execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
          emit,
        },
      },
      { outcome: 'converged', rounds: 1, openBlockers: [], openMaterial: [], openNitpicks: [] },
    )
    expect(result.outcome).toBe('approved')
    expect(result.version).toBe(3)
    const after = await loadRunState(workDir, state.runId)
    expect(after.status).toBe('completed')
    expect(after.gate).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('runGateResume deadline waiter entry (D11)', () => {
  interface WaiterFixture {
    readonly deps: OrchestratorDeps
    readonly workDir: string
    readonly runId: string
    readonly stdoutLines: string[]
  }

  async function makeWaiterFixture(opts: {
    readonly gateMd?: string
    readonly steer?: string
    readonly deadlineAt?: string | null
  }): Promise<WaiterFixture> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-waiter-entry-'))
    const workDir = path.join(dir, 'work')
    const state = await createRunState({ workDir, repoRoot: dir, changeName: 'thing' })
    state.gate = { mode: 'final', version: 1 }
    state.round = 1
    state.gateDeadlineAt = opts.deadlineAt === undefined ? new Date(Date.now() + 60_000).toISOString() : opts.deadlineAt
    await saveRunState(state)
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    fs.writeFileSync(
      path.join(state.runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({ resolutions: [], assumptions: [] }),
    )
    fs.writeFileSync(path.join(state.runDir, 'gate-1.md'), opts.gateMd ?? '## Final gate\n\n- [ ] A1 thing holds\n')
    fs.writeFileSync(path.join(state.runDir, 'gate-hashes-1.json'), '{}')
    const changeDir = path.join(dir, 'openspec', 'changes', 'thing')
    fs.mkdirSync(changeDir, { recursive: true })
    if (opts.steer !== undefined) fs.writeFileSync(path.join(state.runDir, 'steer.md'), opts.steer)
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      config: {
        repoRoot: dir,
        workDir,
        model: 'm',
        models: {},
        timeouts: { wallClockMs: 60_000, inactivityMs: 5_000 },
      },
      spawn: (_command, args, options) => {
        const prompt = String(args[args.length - 1])
        if (prompt.includes('veto-updater')) {
          const target = path.join(options.cwd, '.review-loop', 'veto-updater.json')
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(target, JSON.stringify({ files_updated: [] }))
        }
        const sidecar = prompt.match(/\.review-loop\/([\w-]+\.json)/u)?.[1]
        if (sidecar !== undefined && (sidecar.startsWith('findings-') || sidecar.startsWith('resolutions-'))) {
          const target = path.join(options.cwd, '.review-loop', sidecar)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(
            target,
            sidecar.startsWith('findings-')
              ? JSON.stringify({ findings: [] })
              : JSON.stringify({ resolutions: [], assumptions: [] }),
          )
        }
        if (sidecar === 'decompose-tasks.json') {
          const target = path.join(options.cwd, '.review-loop', sidecar)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(target, JSON.stringify({ tasks_file: 'openspec/changes/thing/tasks.md' }))
        }
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
      },
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: createOpenSpecDriver({
        exec: (args: readonly string[]) => {
          if (args[1] === 'instructions') {
            return Promise.resolve({
              stdout: JSON.stringify({
                instruction: 'write the artifact',
                resolvedOutputPath: path.join(dir, 'openspec', 'changes', 'thing', 'tasks.md'),
              }),
              stderr: '',
              exitCode: 0,
            })
          }
          return Promise.resolve({ stdout: 'is valid', stderr: '', exitCode: 0 })
        },
        cwd: dir,
      }),
      stdout: (line: string): void => {
        stdoutLines.push(line)
      },
      interactive: () => false,
    }
    return { deps, workDir, runId: state.runId, stdoutLines }
  }

  it('a steer abort lands through the waiter without touching the gate file', async () => {
    const fx = await makeWaiterFixture({ steer: 'abort\n' })
    const result = await runGateResume(fx.deps, fx.runId, {})
    expect(result.outcome).toBe('aborted')
    const state = await loadRunState(fx.workDir, fx.runId)
    expect(state.status).toBe('aborted')
  }, 15_000)

  it('a steer veto lands as a veto with its redirect', async () => {
    const fx = await makeWaiterFixture({ steer: 'veto A1=keep it narrower\n' })
    const resolutionsPath = path.join(fx.workDir, 'runs', fx.runId, 'sidecars', 'resolutions-1.json')
    fs.writeFileSync(
      resolutionsPath,
      JSON.stringify({
        resolutions: [],
        assumptions: [
          {
            id: 'A1',
            text: 'thing holds',
            basis: 'default',
            confidence: 'medium',
            blast_radius: 'one reply',
            status: 'open',
            evidence: { files: ['openspec/changes/thing/proposal.md'] },
          },
        ],
      }),
    )
    const result = await runGateResume(fx.deps, fx.runId, {})
    expect(result.outcome).toBe('veto')
    expect(result.version).toBe(2)
    const updated = fs.readFileSync(resolutionsPath, 'utf8')
    expect(updated).toContain('keep it narrower')
  }, 15_000)

  it('a non-TTY flagless gate with no deadline skips the waiter and parses the file', async () => {
    const fx = await makeWaiterFixture({ deadlineAt: null, gateMd: '## Final gate\n\nABORT\n' })
    const result = await runGateResume(fx.deps, fx.runId, {})
    expect(result.outcome).toBe('aborted')
  })

  it('decision flags bypass the waiter even with a deadline pending', async () => {
    const fx = await makeWaiterFixture({ gateMd: '## Final gate\n\nABORT\n' })
    const result = await runGateResume(fx.deps, fx.runId, { abort: true })
    expect(result.outcome).toBe('aborted')
    const state = await loadRunState(fx.workDir, fx.runId)
    expect(state.status).toBe('aborted')
  })
})

describe('runGateResume waiter bypass flags (D11)', () => {
  async function makeBypassFixture(): Promise<{ deps: OrchestratorDeps; workDir: string; runId: string }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-bypass-'))
    const workDir = path.join(dir, 'work')
    const state = await createRunState({ workDir, repoRoot: dir, changeName: 'thing' })
    state.gate = { mode: 'final', version: 1 }
    state.round = 1
    state.gateDeadlineAt = new Date(Date.now() + 60_000).toISOString()
    await saveRunState(state)
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    fs.writeFileSync(
      path.join(state.runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed' }],
        assumptions: [
          {
            id: 'A1',
            text: 'thing holds',
            basis: 'default',
            confidence: 'medium',
            blast_radius: 'one reply',
            status: 'open',
            evidence: { files: ['openspec/changes/thing/proposal.md'] },
          },
        ],
      }),
    )
    fs.writeFileSync(
      path.join(state.runDir, 'gate-1.md'),
      '## Final gate\n\n- [ ] A1 thing holds\n- [ ] F1 material gap\n',
    )
    fs.writeFileSync(path.join(state.runDir, 'gate-hashes-1.json'), '{}')
    fs.mkdirSync(path.join(dir, 'openspec', 'changes', 'thing'), { recursive: true })
    const deps: OrchestratorDeps = {
      config: {
        repoRoot: dir,
        workDir,
        model: 'm',
        models: {},
        timeouts: { wallClockMs: 60_000, inactivityMs: 5_000 },
      },
      spawn: (_command, args, options) => {
        const prompt = String(args[args.length - 1])
        if (prompt.includes('veto-updater')) {
          const target = path.join(options.cwd, '.review-loop', 'veto-updater.json')
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(target, JSON.stringify({ files_updated: [] }))
        }
        const sidecar = prompt.match(/\.review-loop\/([\w-]+\.json)/u)?.[1]
        if (sidecar !== undefined && (sidecar.startsWith('findings-') || sidecar.startsWith('resolutions-'))) {
          const target = path.join(options.cwd, '.review-loop', sidecar)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(
            target,
            sidecar.startsWith('findings-')
              ? JSON.stringify({ findings: [] })
              : JSON.stringify({ resolutions: [], assumptions: [] }),
          )
        }
        if (sidecar === 'decompose-tasks.json') {
          const target = path.join(options.cwd, '.review-loop', sidecar)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(target, JSON.stringify({ tasks_file: 'openspec/changes/thing/tasks.md' }))
        }
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
      },
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: createOpenSpecDriver({
        exec: (args: readonly string[]) => {
          if (args[1] === 'instructions') {
            return Promise.resolve({
              stdout: JSON.stringify({
                instruction: 'write the artifact',
                resolvedOutputPath: path.join(dir, 'openspec', 'changes', 'thing', 'tasks.md'),
              }),
              stderr: '',
              exitCode: 0,
            })
          }
          return Promise.resolve({ stdout: 'is valid', stderr: '', exitCode: 0 })
        },
        cwd: dir,
      }),
      stdout: (): void => undefined,
      interactive: () => false,
    }
    return { deps, workDir, runId: state.runId }
  }

  it('confirm-all bypasses the waiter and approves immediately', async () => {
    const fx = await makeBypassFixture()
    const result = await runGateResume(fx.deps, fx.runId, { confirmAll: true })
    expect(result.outcome).toBe('approved')
    const state = await loadRunState(fx.workDir, fx.runId)
    expect(state.status).toBe('completed')
  })

  it('a veto flag bypasses the waiter and lands the veto', async () => {
    const fx = await makeBypassFixture()
    const result = await runGateResume(fx.deps, fx.runId, {
      confirmAll: true,
      vetoes: [{ id: 'A1', redirect: 'narrow it' }],
    })
    expect(result.outcome).toBe('veto')
    expect(result.version).toBe(2)
  })

  it('no-wait bypasses the waiter even with a deadline pending', async () => {
    const fx = await makeBypassFixture()
    fs.writeFileSync(path.join(fx.workDir, 'runs', fx.runId, 'gate-1.md'), '## Final gate\n\nABORT\n')
    const result = await runGateResume(fx.deps, fx.runId, { noWait: true })
    expect(result.outcome).toBe('aborted')
  })

  it('a deadline-pending gate with steer extend at a final gate warns and stays on the flag path', async () => {
    const fx = await makeBypassFixture()
    fs.writeFileSync(path.join(fx.workDir, 'runs', fx.runId, 'steer.md'), 'extend\n')
    fs.writeFileSync(path.join(fx.workDir, 'runs', fx.runId, 'gate-1.md'), '## Final gate\n\nABORT\n')
    const result = await runGateResume(fx.deps, fx.runId, { noWait: true })
    expect(result.outcome).toBe('aborted')
  })

  it('--wait-deadline forces the waiter on even when no deadline is set', async () => {
    const fx = await makeBypassFixture()
    const state = await loadRunState(fx.workDir, fx.runId)
    state.gateDeadlineAt = null
    await saveRunState(state)
    fs.writeFileSync(path.join(fx.workDir, 'runs', fx.runId, 'steer.md'), 'abort\n')
    const result = await runGateResume(fx.deps, fx.runId, { waitDeadline: true })
    expect(result.outcome).toBe('aborted')
  }, 15_000)

  it('a TTY with a deadline pending skips the waiter and runs the interactive session', async () => {
    const fx = await makeBypassFixture()
    fs.writeFileSync(path.join(fx.workDir, 'runs', fx.runId, 'gate-1.md'), '## Final gate\n\nABORT\n')
    const { prompter } = scriptedPrompter(['q'])
    const deps: OrchestratorDeps = { ...fx.deps, interactive: () => true, makePrompter: () => prompter }
    const result = await runGateResume(deps, fx.runId, {})
    expect(result.outcome).toBe('abandoned')
  })

  it('an extend flag bypasses the waiter even with a deadline pending', async () => {
    const fx = await makeBypassFixture()
    const state = await loadRunState(fx.workDir, fx.runId)
    state.gate = { mode: 'early', version: 1 }
    await saveRunState(state)
    const result = await runGateResume(fx.deps, fx.runId, { extend: true })
    expect(result.outcome).toBe('extend')
    expect(result.version).toBe(2)
  }, 15_000)
})
