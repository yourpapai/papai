// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { EventInputSchema, appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import type { ChangeDigest } from '../../sdd-runner/src/gate-digest-extract.js'
import { presentGateAt } from '../../sdd-runner/src/gate-digest.js'
import {
  presentGate,
  resumeGate,
  runGateReopen,
  verifyGateIntegrity,
  vetoRedirects,
} from '../../sdd-runner/src/gate.js'
import type { GateDeps } from '../../sdd-runner/src/gate.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { createRunState, loadRunState } from '../../sdd-runner/src/run-state.js'

const NULL_DIGEST: ChangeDigest = { what: null, why: null, touches: null, hasTasks: false }

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

interface Fixture {
  readonly deps: GateDeps
  readonly changeDir: string
  readonly runDir: string
  readonly emitted: EventInput[]
  readonly driftCalls: Array<readonly string[]>
}

function makeFixture(dir: string): Fixture {
  const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
  fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nx\n')
  fs.writeFileSync(path.join(changeDir, 'specs', 'thing', 'spec.md'), '## ADDED Requirements\n')
  fs.writeFileSync(path.join(changeDir, 'design.md'), '## Context\n')
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), '## 1. x\n- [ ] 1.1 y\n')
  const runDir = path.join(dir, 'run-1')
  fs.mkdirSync(runDir, { recursive: true })
  const driftCalls: Array<readonly string[]> = []
  const emitted: EventInput[] = []
  const deps: GateDeps = {
    emit: (event) => {
      emitted.push(EventInputSchema.parse(event))
    },
    runDir,
    changeDir,
    driftCheck: (files) => {
      driftCalls.push(files)
      return Promise.resolve()
    },
  }
  return { deps, changeDir, runDir, emitted, driftCalls }
}

describe('presentGate', () => {
  it('writes a versioned gate file, records artifact hashes, and emits a presented event', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    const result = await presentGate(fixture.deps, {
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [{ id: 'A1', text: 'guests read-only', blast_radius: 'group replies' }],
      blockers: [],
      summary: 'add a thing',
      costUsd: 0.5,
      costKnown: true,
      durationMs: 1000,
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
      changeDigest: NULL_DIGEST,
    })
    expect(result.gateMdPath).toBe(path.join(fixture.runDir, 'gate-1.md'))
    expect(fs.existsSync(result.gateMdPath)).toBe(true)
    expect(fs.existsSync(path.join(fixture.runDir, 'gate-hashes-1.json'))).toBe(true)
    const events = fixture.emitted
    expect(events[0]).toMatchObject({ type: 'gate', action: 'presented', mode: 'final', version: 1 })
  })
})

describe('resumeGate', () => {
  it('approves when the human checks every assumption box', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await presentGate(fixture.deps, {
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      blockers: [],
      summary: 's',
      costUsd: 0,
      costKnown: false,
      durationMs: 0,
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
      changeDigest: NULL_DIGEST,
    })
    const md = fs.readFileSync(path.join(fixture.runDir, 'gate-1.md'), 'utf8').replace('- [ ] A1', '- [x] A1')
    fs.writeFileSync(path.join(fixture.runDir, 'gate-1.md'), md)
    const outcome = await resumeGate(fixture.deps, {
      version: 1,
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      blockers: [],
      gateMode: 'final',
    })
    expect(outcome.kind).toBe('approved')
    expect(fixture.driftCalls).toHaveLength(0)
  })

  it('returns vetoes with redirects when an assumption is left unchecked', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await presentGate(fixture.deps, {
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [
        { id: 'A1', text: 'first', blast_radius: 'y' },
        { id: 'A2', text: 'second', blast_radius: 'w' },
      ],
      blockers: [],
      summary: 's',
      costUsd: 0,
      costKnown: false,
      durationMs: 0,
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
      changeDigest: NULL_DIGEST,
    })
    const md = fs
      .readFileSync(path.join(fixture.runDir, 'gate-1.md'), 'utf8')
      .replace('- [ ] A1 first', '- [ ] A1 first\n→ narrow it to dm-only')
      .replace('- [ ] A2 second', '- [x] A2 second')
    fs.writeFileSync(path.join(fixture.runDir, 'gate-1.md'), md)
    const outcome = await resumeGate(fixture.deps, {
      version: 1,
      assumptions: [
        { id: 'A1', text: 'first', blast_radius: 'y' },
        { id: 'A2', text: 'second', blast_radius: 'w' },
      ],
      blockers: [],
      gateMode: 'final',
    })
    expect(outcome.kind).toBe('veto')
    expect(vetoRedirects(outcome)).toEqual([{ id: 'A1', redirect: 'narrow it to dm-only' }])
  })

  it('detects hand edits to specs or design and runs the drift check', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await presentGate(fixture.deps, {
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      blockers: [],
      summary: 's',
      costUsd: 0,
      costKnown: false,
      durationMs: 0,
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
      changeDigest: NULL_DIGEST,
    })
    fs.writeFileSync(
      path.join(fixture.changeDir, 'specs', 'thing', 'spec.md'),
      '## ADDED Requirements\n### Requirement: Changed\n',
    )
    const md = fs.readFileSync(path.join(fixture.runDir, 'gate-1.md'), 'utf8').replace('- [ ] A1', '- [x] A1')
    fs.writeFileSync(path.join(fixture.runDir, 'gate-1.md'), md)
    const outcome = await resumeGate(fixture.deps, {
      version: 1,
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      blockers: [],
      gateMode: 'final',
    })
    expect(outcome.kind).toBe('approved')
    expect(fixture.driftCalls[0]).toContain('specs/thing/spec.md')
  })

  it('aborts on an ABORT marker', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await presentGate(fixture.deps, {
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      blockers: [],
      summary: 's',
      costUsd: 0,
      costKnown: false,
      durationMs: 0,
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
      changeDigest: NULL_DIGEST,
    })
    fs.writeFileSync(path.join(fixture.runDir, 'gate-1.md'), 'ABORT\n')
    const outcome = await resumeGate(fixture.deps, {
      version: 1,
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      blockers: [],
      gateMode: 'final',
    })
    expect(outcome.kind).toBe('aborted')
  })

  it('returns extend when the human writes RUN 1 MORE at an early gate', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    fs.writeFileSync(path.join(fixture.runDir, 'gate-1.md'), '→ RUN 1 MORE\n')
    const outcome = await resumeGate(fixture.deps, {
      version: 1,
      assumptions: [],
      blockers: [],
      gateMode: 'early',
    })
    expect(outcome.kind).toBe('extend')
    expect(fixture.emitted).toHaveLength(1)
    expect(fixture.emitted[0]).toMatchObject({
      type: 'gate',
      action: 'answered',
      altitude: 'L2',
      mode: 'early',
      version: 1,
    })
  })
})

describe('presentGateAt policy prelude (observe + integrity cross-checks)', () => {
  const CONVERGED = {
    outcome: 'converged' as const,
    rounds: 1,
    openBlockers: [],
    openMaterial: [],
    openNitpicks: [],
  }

  interface PreludeFixture {
    readonly workDir: string
    readonly repoRoot: string
    readonly state: import('../../sdd-runner/src/run-state.js').RunState
    readonly deps: import('../../sdd-runner/src/gate-digest.js').OrchestratorDeps
    readonly stdoutLines: string[]
  }

  async function makePreludeFixture(
    sidecarAssumptions: unknown,
    opts: { convergenceCounts?: { blocker: number; material: number; nitpick: number } } = {},
  ): Promise<PreludeFixture> {
    const dir = makeDir()
    const repoRoot = dir
    const workDir = path.join(dir, '.sdd-runner')
    const state = await createRunState({ workDir, repoRoot, changeName: 'add-thing' })
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    fs.writeFileSync(
      path.join(state.runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({ resolutions: [], assumptions: sidecarAssumptions }),
    )
    const logPath = path.join(state.runDir, 'events.ndjson')
    const events: import('../../sdd-runner/src/events.js').EventInput[] = [
      { altitude: 'L2', type: 'stage_enter', stage: 'review' },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 1 },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'converged',
        counts: opts.convergenceCounts ?? { blocker: 0, material: 0, nitpick: 0 },
      },
      { altitude: 'L2', type: 'round_close', round: 1, cap: 1 },
    ]
    for (const event of events) appendEvent(logPath, event)
    const stdoutLines: string[] = []
    const deps: import('../../sdd-runner/src/gate-digest.js').OrchestratorDeps = {
      config: {
        repoRoot,
        workDir,
        model: 'test-model',
        models: {},
        timeouts: { wallClockMs: 60_000, inactivityMs: 5_000 },
      },
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: createOpenSpecDriver({
        exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
        cwd: repoRoot,
      }),
      resolveCost: () => null,
      stdout: (line) => {
        stdoutLines.push(line)
      },
      now: () => new Date('2026-08-12T08:00:00.000Z'),
    }
    return { workDir, repoRoot, state, deps, stdoutLines }
  }

  function ctxOf(fixture: PreludeFixture): import('../../sdd-runner/src/gate-digest.js').StageContext {
    const logPath = path.join(fixture.state.runDir, 'events.ndjson')
    return {
      cwd: fixture.repoRoot,
      changeDir: path.join(fixture.repoRoot, 'openspec', 'changes', fixture.state.changeName),
      sidecarDir: path.join(fixture.state.runDir, 'sidecars'),
      emit: (event) => {
        appendEvent(logPath, event)
      },
    }
  }

  it('observe preview: appends a parse-inert preview block, one sidecar line, one preview event; stdout unchanged', async () => {
    const fixture = await makePreludeFixture([])
    const result = await presentGateAt(fixture.deps, fixture.state, ctxOf(fixture), CONVERGED, 1, 'final')
    expect(result.halted).toBe('gate')

    const gateMd = fs.readFileSync(result.gateMdPath, 'utf8')
    expect(gateMd).toContain('### Auto-decision preview')
    const previewStart = gateMd.split('\n').findIndex((l) => l.trim() === '### Auto-decision preview')
    expect(previewStart).toBeGreaterThan(-1)
    const previewLines = gateMd
      .split('\n')
      .slice(previewStart + 1)
      .filter((line) => line.trim().length > 0)
    for (const line of previewLines) expect(line.startsWith('> ')).toBe(true)

    const sidecarLine = fs.readFileSync(path.join(fixture.state.runDir, 'auto-policy.jsonl'), 'utf8').trim()
    expect(sidecarLine.includes('\n')).toBe(false)
    expect(JSON.parse(sidecarLine)).toMatchObject({ gateVersion: 1, decision: 'preview' })

    const autoDecisions = readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
      (e) => e.type === 'auto_decision',
    )
    expect(autoDecisions).toHaveLength(1)
    expect(autoDecisions[0]).toMatchObject({ decision: 'preview', gateVersion: 1 })

    expect(fixture.stdoutLines.some((l) => l.includes('gate resume'))).toBe(true)
  })

  it('observe preview names R1 for a converged, all-low-blast final gate', async () => {
    const fixture = await makePreludeFixture([])
    const logPath = path.join(fixture.state.runDir, 'events.ndjson')
    appendEvent(logPath, {
      altitude: 'L2',
      type: 'artifact',
      action: 'materialized',
      path: path.join('openspec', 'changes', 'add-thing', 'proposal.md'),
    })
    fs.writeFileSync(
      path.join(fixture.state.runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({
        resolutions: [],
        assumptions: [
          {
            id: 'A1',
            text: 't',
            basis: 'default',
            confidence: 'high',
            blast_radius: 'b',
            status: 'open',
            evidence: { files: [path.join('openspec', 'changes', 'add-thing', 'proposal.md')] },
          },
        ],
      }),
    )
    await presentGateAt(fixture.deps, fixture.state, ctxOf(fixture), CONVERGED, 1, 'final')
    const autoDecisions = readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
      (e) => e.type === 'auto_decision',
    )
    expect(autoDecisions[0]).toMatchObject({ rule: 'R1' })
    const gateMd = fs.readFileSync(path.join(fixture.state.runDir, 'gate-1.md'), 'utf8')
    expect(gateMd).toMatch(/> rule: R1/u)
  })

  it('integrity cross-check: an unparseable resolver sidecar yields a human-gate preview, never R1', async () => {
    const fixture = await makePreludeFixture([])
    fs.writeFileSync(path.join(fixture.state.runDir, 'sidecars', 'resolutions-1.json'), '{ not json')
    await presentGateAt(fixture.deps, fixture.state, ctxOf(fixture), CONVERGED, 1, 'final')
    const autoDecisions = readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
      (e) => e.type === 'auto_decision',
    )
    expect(autoDecisions[0]).toMatchObject({ rule: 'none', decision: 'preview' })
  })

  it('integrity cross-check: R1 requires replay-folded counts to agree with sidecar counts', async () => {
    const fixture = await makePreludeFixture([])
    fs.writeFileSync(
      path.join(fixture.state.runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'assumed', outcome: 'kept' }],
        assumptions: [],
      }),
    )
    await presentGateAt(fixture.deps, fixture.state, ctxOf(fixture), CONVERGED, 1, 'final')
    const autoDecisions = readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
      (e) => e.type === 'auto_decision',
    )
    expect(autoDecisions[0]).toMatchObject({ rule: 'none' })
  })

  it('skipPolicy: settleVeto-style re-presentations get no preview, sidecar, or event', async () => {
    const fixture = await makePreludeFixture([])
    await presentGateAt(fixture.deps, fixture.state, ctxOf(fixture), CONVERGED, 1, 'final', {
      skipPolicy: true,
    })
    expect(fs.existsSync(path.join(fixture.state.runDir, 'auto-policy.jsonl'))).toBe(false)
    const autoDecisions = readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
      (e) => e.type === 'auto_decision',
    )
    expect(autoDecisions).toHaveLength(0)
    const gateMd = fs.readFileSync(path.join(fixture.state.runDir, 'gate-1.md'), 'utf8')
    expect(gateMd).not.toContain('### Auto-decision preview')
  })

  describe('auto-settle resume reconciliation (7.3)', () => {
    it('an auto_decision approve without its paired gate answered re-runs the prelude idempotently', async () => {
      const fixture = await makePreludeFixture([])
      const deps: import('../../sdd-runner/src/gate-digest.js').OrchestratorDeps = {
        ...fixture.deps,
        autonomy: { level: 'assist', costCeilingUsd: 5, autoExtendMax: 1, deadlineMinutes: undefined, rules: {} },
      }
      const first = await presentGateAt(deps, fixture.state, ctxOf(fixture), CONVERGED, 1, 'final')
      expect(first.halted).toBe('gate')
      const after = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
      expect(after.status).toBe('completed')

      // Crash simulation: build a fresh state with the auto_decision event but
      // no paired gate answered, status running, gate null — replay must treat
      // it as not-decided and the re-presented prelude settles again.
      const logPath = path.join(fixture.state.runDir, 'events.ndjson')
      const events = readEvents(logPath)
      const cutAt = answeredEventIndex(events)
      expect(cutAt).toBeGreaterThan(-1)
      const truncated = events.slice(0, cutAt)
      fs.writeFileSync(logPath, `${truncated.map((e) => JSON.stringify(e)).join('\n')}\n`)
      const crashed: import('../../sdd-runner/src/run-state.js').PersistedRunState = {
        ...after,
        status: 'running',
        gate: { mode: 'final', version: 1 },
      }
      fs.writeFileSync(
        path.join(fixture.state.runDir, 'state.json'),
        `${JSON.stringify({ ...crashed, runDir: undefined, statePath: undefined }, null, 2)}\n`,
      )
      const reloaded = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
      const rePresented = await presentGateAt(deps, reloaded, ctxOf(fixture), CONVERGED, 2, 'final')
      expect(rePresented.halted).toBe('gate')
      const settled = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
      expect(settled.status).toBe('completed')
    })
  })
})

describe('verifyGateIntegrity shared helper (7.1)', () => {
  it('detects hand edits, runs the drift check on spec/design edits, and emits human_edits', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await presentGate(fixture.deps, {
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [],
      blockers: [],
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
      summary: 'add-thing',
      costUsd: 0,
      costKnown: true,
      durationMs: 0,
      changeDigest: NULL_DIGEST,
    })
    fs.appendFileSync(path.join(fixture.changeDir, 'design.md'), 'human tweak\n')
    await verifyGateIntegrity(fixture.deps, 1)
    const edits = fixture.emitted.filter((e) => e.type === 'human_edits')
    expect(edits).toHaveLength(1)
    expect(fixture.driftCalls).toHaveLength(1)
  })

  it('no edits: no drift check, no human_edits event', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await presentGate(fixture.deps, {
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [],
      blockers: [],
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
      summary: 'add-thing',
      costUsd: 0,
      costKnown: true,
      durationMs: 0,
      changeDigest: NULL_DIGEST,
    })
    await verifyGateIntegrity(fixture.deps, 1)
    expect(fixture.emitted.filter((e) => e.type === 'human_edits')).toHaveLength(0)
    expect(fixture.driftCalls).toHaveLength(0)
  })
})

function answeredEventIndex(events: readonly ReturnType<typeof readEvents>[number][]): number {
  return events.findIndex((e) => e.type === 'gate' && (e as { action: string }).action === 'answered')
}

describe('gate reopen (10.2)', () => {
  async function seedSettledGate(opts: { status?: 'completed' | 'running' } = {}): Promise<{
    workDir: string
    runId: string
    deps: import('../../sdd-runner/src/gate-digest.js').OrchestratorDeps
  }> {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd-runner')
    const state = await createRunState({ workDir, repoRoot: dir, changeName: 'add-thing' })
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'openspec', 'changes', 'add-thing'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'openspec', 'changes', 'add-thing', 'proposal.md'), '## Why\nx\n')
    const logPath = path.join(state.runDir, 'events.ndjson')
    appendEvent(logPath, { altitude: 'L2', type: 'stage_enter', stage: 'gate' })
    appendEvent(logPath, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 })
    appendEvent(logPath, { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1 })
    const gateMd = [
      '<!-- gate-1.md -->',
      '',
      '## Final gate — change add-thing',
      '',
      '### Assumptions (blast-ranked)',
      '',
      '- [x] A1 ok assumption',
      '',
      '## Gate response',
      '',
      '- [x] A1 ok assumption',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(state.runDir, 'gate-1.md'), gateMd)
    fs.writeFileSync(path.join(state.runDir, 'gate-hashes-1.json'), JSON.stringify({ 'proposal.md': 'h' }))
    const status = opts.status ?? 'completed'
    const stateRaw = fs.readFileSync(state.statePath, 'utf8')
    fs.writeFileSync(
      state.statePath,
      stateRaw.replace('"status": "running"', `"status": "${status}"`).replace('"gate": null', '"gate": null'),
    )
    const deps: import('../../sdd-runner/src/gate-digest.js').OrchestratorDeps = {
      config: {
        repoRoot: dir,
        workDir,
        model: 'test-model',
        models: {},
        timeouts: { wallClockMs: 60_000, inactivityMs: 5_000 },
      },
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: createOpenSpecDriver({
        exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
        cwd: dir,
      }),
    }
    return { workDir, runId: state.runId, deps }
  }

  it('re-renders a settled final gate at a fresh version, unanswered, and reverts completed status', async () => {
    const { workDir, runId, deps } = await seedSettledGate()
    const result = await runGateReopen(deps, workDir, runId, 1)
    expect(result.gateVersion).toBe(2)

    const state = await loadRunState(workDir, runId)
    expect(state.gate).toEqual({ mode: 'final', version: 2 })
    expect(state.status).toBe('running')

    const fresh = fs.readFileSync(path.join(state.runDir, 'gate-2.md'), 'utf8')
    expect(fresh).toContain('- [ ] A1')
    expect(fresh).not.toContain('## Gate response')
    expect(fs.existsSync(path.join(state.runDir, 'gate-hashes-2.json'))).toBe(true)
  })

  it('refuses when a gate is already pending', async () => {
    const { workDir, runId, deps } = await seedSettledGate({ status: 'running' })
    const stateRaw = fs.readFileSync(path.join(workDir, 'runs', runId, 'state.json'), 'utf8')
    fs.writeFileSync(
      path.join(workDir, 'runs', runId, 'state.json'),
      stateRaw.replace('"gate": null', '"gate": {"mode":"final","version":1}'),
    )
    await expect(runGateReopen(deps, workDir, runId, 1)).rejects.toThrow(/pending/u)
  })

  it('refuses a missing or non-latest settled gate', async () => {
    const { workDir, runId, deps } = await seedSettledGate()
    await expect(runGateReopen(deps, workDir, runId, 9)).rejects.toThrow(/not.*settled|no settled gate/iu)
    fs.writeFileSync(path.join(workDir, 'runs', runId, 'gate-2.md'), '<!-- gate-2.md -->')
    appendEvent(path.join(workDir, 'runs', runId, 'events.ndjson'), {
      altitude: 'L2',
      type: 'gate',
      action: 'presented',
      mode: 'final',
      version: 2,
    })
    appendEvent(path.join(workDir, 'runs', runId, 'events.ndjson'), {
      altitude: 'L2',
      type: 'gate',
      action: 'answered',
      mode: 'final',
      version: 2,
    })
    await expect(runGateReopen(deps, workDir, runId, 1)).rejects.toThrow(/latest/u)
  })
})
