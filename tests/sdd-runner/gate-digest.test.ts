// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AutonomyConfig } from '../../sdd-runner/src/config.js'
import type { SddEvent } from '../../sdd-runner/src/events.js'
import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import {
  blockersOf,
  buildBus,
  findingsOf,
  presentGateAt,
  readReviewResultFromSidecars,
} from '../../sdd-runner/src/gate-digest.js'
import type { OrchestratorDeps, StageContext } from '../../sdd-runner/src/gate-digest.js'
import type { GateChild } from '../../sdd-runner/src/gate-model.js'
import { writeGateDigest } from '../../sdd-runner/src/gate-model.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import type { ReviewLoopResult } from '../../sdd-runner/src/review-loop.js'
import { createRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'
import { costAndDuration } from '../../sdd-runner/src/usage-aggregate.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gd-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('blockersOf', () => {
  it('maps open blockers to gate blocker entries', () => {
    const result: ReviewLoopResult = {
      outcome: 'cap-hit',
      rounds: 2,
      openBlockers: [
        { id: 'F1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' },
        { id: 'F2', class: 'BLOCKER', resolution: 'dismissed', justification: 'nope' },
      ],
      openMaterial: [],
      openNitpicks: [],
    }
    expect(blockersOf(result)).toEqual([
      { id: 'F1', gap: 'F1', evidence: 'defaulted' },
      { id: 'F2', gap: 'F2', evidence: 'nope' },
    ])
  })
})

describe('findingsOf', () => {
  it('maps open blockers and open material to gate finding entries', () => {
    const result: ReviewLoopResult = {
      outcome: 'cap-hit',
      rounds: 3,
      openBlockers: [{ id: 'F1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' }],
      openMaterial: [
        { id: 'F2', class: 'MATERIAL', resolution: 'edited', outcome: 'gap narrowed' },
        { id: 'F3', class: 'MATERIAL', resolution: 'dismissed', justification: 'answered in design' },
      ],
      openNitpicks: [],
    }
    expect(findingsOf(result)).toEqual({
      blockers: [{ id: 'F1', gap: 'F1', evidence: 'defaulted' }],
      material: [
        { id: 'F2', gap: 'F2', evidence: 'edited — gap narrowed' },
        { id: 'F3', gap: 'F3', evidence: 'dismissed — answered in design' },
      ],
      nitpicks: [],
    })
  })
})

describe('costAndDuration', () => {
  it('sums done-event cost and measures elapsed time', () => {
    const events: readonly SddEvent[] = [
      {
        altitude: 'L1',
        type: 'done',
        agent: 'a',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.25,
          wallMs: 0,
        },
        seq: 1,
        ts: 'x',
      },
    ]
    const { costUsd, durationMs } = costAndDuration(
      events,
      '2026-01-01T00:00:00.000Z',
      new Date('2026-01-01T00:00:01.000Z'),
    )
    expect(costUsd).toBe(0.25)
    expect(durationMs).toBe(1000)
  })
})

describe('writeGateDigest cost marker', () => {
  const base = {
    version: 1,
    mode: 'final' as const,
    changeName: 'add-thing',
    runId: 'run-1',
    assumptions: [],
    blockers: [],
    openMaterial: [],
    openNitpicks: [],
    trajectory: [],
    capHitFired: true,
    summary: 'add a thing',
    durationMs: 2607_000,
    changeDigest: { what: null, why: null, touches: null, hasTasks: false },
  }

  it('renders metered when costKnown is true', () => {
    const md = writeGateDigest({ ...base, costUsd: 1.23, costKnown: true })
    expect(md).toContain(`### Cost / duration · $1.23 · 2607s · metered`)
  })

  it('renders estimated when costKnown is false but cost is non-zero', () => {
    const md = writeGateDigest({ ...base, costUsd: 1.23, costKnown: false })
    expect(md).toContain(`### Cost / duration · $1.23 · 2607s · estimated`)
  })

  it('renders unknown when costKnown is false and cost is zero', () => {
    const md = writeGateDigest({ ...base, costUsd: 0, costKnown: false })
    expect(md).toContain(`### Cost / duration · $0.00 · 2607s · unknown`)
  })
})

describe('writeGateDigest change digest section', () => {
  const digestBase = {
    version: 1,
    changeName: 'add-thing',
    runId: 'run-1',
    blockers: [],
    openMaterial: [],
    openNitpicks: [],
    trajectory: [],
    capHitFired: false,
    summary: 'add-thing',
    costUsd: 1.5,
    costKnown: true,
    durationMs: 120_000,
  }

  it('renders ### Change digest between ### Summary and ### Cost / duration with the 5-tuple (task 2.1)', () => {
    const md = writeGateDigest({
      ...digestBase,
      mode: 'final',
      assumptions: [{ id: 'A1', text: 'guests read-only', blast_radius: 'group replies' }],
      changeDigest: { what: 'X', why: 'Y', touches: ['file-a', 'file-b'], hasTasks: false },
    })
    const digestIdx = md.indexOf('### Change digest')
    const summaryIdx = md.indexOf('### Summary')
    const costIdx = md.indexOf('### Cost / duration')
    expect(digestIdx).toBeGreaterThan(-1)
    expect(summaryIdx).toBeLessThan(digestIdx)
    expect(digestIdx).toBeLessThan(costIdx)
    expect(md).toContain('- **WHAT**: X')
    expect(md).toContain('- **WHY**: Y')
    expect(md).toContain('- **TOUCHES**: file-a, file-b')
    expect(md).toMatch(/- \*\*RISKS\*\*: see "[^"]+" below/u)
    expect(md).toMatch(/- \*\*BLAST\*\*: see "[^"]+" below/u)
  })

  it('renders placeholders for null fields, mode-aware RISKS, and BLAST on empty assumptions (task 2.2)', () => {
    const earlyMd = writeGateDigest({
      ...digestBase,
      mode: 'early',
      assumptions: [],
      changeDigest: { what: null, why: null, touches: null, hasTasks: false },
    })
    expect(earlyMd).toContain('- **WHAT**: _(no "Why" section in proposal.md)_')
    expect(earlyMd).toContain('- **WHY**: _(no "Why" section in proposal.md)_')
    expect(earlyMd).toContain('- **TOUCHES**: _(no "Impact" section in proposal.md)_')
    expect(earlyMd).toContain('- **RISKS**: see "Open MATERIAL findings at cap" below')
    expect(earlyMd).toContain('- **BLAST**: _(no assumptions logged)_')

    const finalMd = writeGateDigest({
      ...digestBase,
      mode: 'final',
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      changeDigest: { what: null, why: null, touches: null, hasTasks: false },
    })
    expect(finalMd).toContain('- **RISKS**: see "Nitpicks (informational)" below')
    expect(finalMd).toContain('- **BLAST**: see "Assumptions (blast-ranked)" below')
  })
})

describe('writeGateDigest ### Extend section', () => {
  const base = {
    version: 1,
    changeName: 'add-thing',
    runId: 'run-1',
    assumptions: [],
    blockers: [],
    openMaterial: [],
    openNitpicks: [],
    trajectory: [],
    summary: 'add a thing',
    costUsd: 0.1,
    costKnown: true,
    durationMs: 60_000,
    changeDigest: { what: null, why: null, touches: null, hasTasks: false },
  }

  it('renders ### Extend with the → RUN 1 MORE directive at an early cap-hit gate', () => {
    const md = writeGateDigest({ ...base, mode: 'early', capHitFired: true })
    expect(md).toContain('### Extend')
    expect(md).toContain('→ RUN 1 MORE')
    expect(md).toContain('runs one more review round, then re-gates')
  })

  it('does not render an ### Extend section at a final gate even when capHitFired is true', () => {
    const md = writeGateDigest({ ...base, mode: 'final', capHitFired: true })
    expect(md).not.toContain('### Extend')
    expect(md).not.toContain('→ RUN 1 MORE')
  })

  it('does not render an ### Extend section at an early gate when capHitFired is false', () => {
    const md = writeGateDigest({ ...base, mode: 'early', capHitFired: false })
    expect(md).not.toContain('### Extend')
  })
})

describe('findingsOf nitpicks (mutation kills)', () => {
  it('renders nitpick evidence as "resolution — outcome" with the justification fallback', () => {
    const result: ReviewLoopResult = {
      outcome: 'converged',
      rounds: 1,
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [
        { id: 'N1', class: 'NITPICK', resolution: 'edited', outcome: 'cosmetic' },
        { id: 'N2', class: 'NITPICK', resolution: 'dismissed', justification: 'follow-up filed' },
      ],
    }
    expect(findingsOf(result).nitpicks).toEqual([
      { id: 'N1', gap: 'N1', evidence: 'edited — cosmetic' },
      { id: 'N2', gap: 'N2', evidence: 'dismissed — follow-up filed' },
    ])
  })

  it('renders empty evidence when a nitpick has neither outcome nor justification', () => {
    const result: ReviewLoopResult = {
      outcome: 'converged',
      rounds: 1,
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [{ id: 'N3', class: 'NITPICK', resolution: 'assumed' }],
    }
    expect(findingsOf(result).nitpicks).toEqual([{ id: 'N3', gap: 'N3', evidence: 'assumed — ' }])
  })
})

describe('readReviewResultFromSidecars', () => {
  function writeResolutions(sidecarDir: string, round: number, payload: unknown): void {
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(path.join(sidecarDir, `resolutions-${round}.json`), JSON.stringify(payload))
  }

  const assumption = {
    id: 'A1',
    text: 'thing holds',
    basis: 'default',
    confidence: 'medium',
    blast_radius: 'one reply',
    status: 'open',
    evidence: { files: ['openspec/changes/thing/proposal.md'] },
  }

  it('buckets parsed resolutions by class, preserving round and outcome', async () => {
    const sidecarDir = path.join(makeDir(), 'sidecars')
    writeResolutions(sidecarDir, 2, {
      resolutions: [
        { id: 'F1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' },
        { id: 'F2', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed' },
        { id: 'N1', class: 'NITPICK', resolution: 'edited', outcome: 'cosmetic' },
      ],
      assumptions: [assumption],
    })
    expect(await readReviewResultFromSidecars(sidecarDir, 2, 'converged')).toEqual({
      outcome: 'converged',
      rounds: 2,
      openBlockers: [{ id: 'F1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' }],
      openMaterial: [{ id: 'F2', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed' }],
      openNitpicks: [{ id: 'N1', class: 'NITPICK', resolution: 'edited', outcome: 'cosmetic' }],
    })
  })

  it('falls back to empty buckets when the sidecar file is missing', async () => {
    const sidecarDir = path.join(makeDir(), 'absent-sidecars')
    expect(await readReviewResultFromSidecars(sidecarDir, 4, 'cap-hit')).toEqual({
      outcome: 'cap-hit',
      rounds: 4,
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
    })
  })

  it('falls back to empty buckets when the sidecar is malformed JSON or schema-invalid', async () => {
    const broken = path.join(makeDir(), 'sidecars')
    fs.mkdirSync(broken, { recursive: true })
    fs.writeFileSync(path.join(broken, 'resolutions-1.json'), '{not json')
    expect(await readReviewResultFromSidecars(broken, 1, 'converged')).toEqual({
      outcome: 'converged',
      rounds: 1,
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
    })

    const invalid = path.join(makeDir(), 'sidecars')
    writeResolutions(invalid, 1, { resolutions: [{ id: 'X1', class: 'NOT_A_CLASS' }], assumptions: [] })
    expect(await readReviewResultFromSidecars(invalid, 1, 'converged')).toMatchObject({
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
    })
  })
})

describe('presentGateAt plan mode (D5)', () => {
  const PLAN_CHILDREN: readonly GateChild[] = [
    { id: 'C1', text: 'auth-db — Add the auth database schema.' },
    { id: 'C2', text: 'auth-api — Add the auth API endpoints.' },
  ]
  const CONVERGED: ReviewLoopResult = {
    outcome: 'converged',
    rounds: 0,
    openBlockers: [],
    openMaterial: [],
    openNitpicks: [],
  }

  interface PlanFixture {
    readonly repoRoot: string
    readonly state: RunState
    readonly deps: OrchestratorDeps
    readonly ctx: StageContext
  }

  async function makePlanFixture(autonomy?: AutonomyConfig): Promise<PlanFixture> {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    const state = await createRunState({ workDir, repoRoot, changeName: 'composite' })
    const logPath = path.join(state.runDir, 'events.ndjson')
    appendEvent(logPath, { altitude: 'L2', type: 'stage_enter', stage: 'intake' })
    const deps: OrchestratorDeps = {
      config: { repoRoot, workDir, model: 'test-model', budget: 5 },
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: createOpenSpecDriver({
        exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
        cwd: repoRoot,
      }),
      resolveCost: () => null,
      now: () => new Date('2026-08-12T08:00:00.000Z'),
      ...(autonomy === undefined ? {} : { autonomy }),
    }
    const ctx: StageContext = {
      cwd: repoRoot,
      changeDir: path.join(repoRoot, 'openspec', 'changes', 'composite'),
      sidecarDir: path.join(state.runDir, 'sidecars'),
      emit: (event) => {
        appendEvent(logPath, event)
      },
    }
    return { repoRoot, state, deps, ctx }
  }

  it('presents the gate file with children rows, hashes sidecar, and a plan-mode presented event; never settles or extends', async () => {
    const fixture = await makePlanFixture()
    const result = await presentGateAt(fixture.deps, fixture.state, fixture.ctx, CONVERGED, 1, 'plan', {
      children: PLAN_CHILDREN,
    })
    expect(result.halted).toBe('gate')
    expect(result.gateMdPath).toBe(path.join(fixture.state.runDir, 'gate-1.md'))

    const md = fs.readFileSync(result.gateMdPath, 'utf8')
    expect(md).toContain('## Plan gate')
    expect(md).toContain('- [ ] C1 auth-db — Add the auth database schema.')
    expect(md).toContain('- [ ] C2 auth-api — Add the auth API endpoints.')

    expect(fs.existsSync(path.join(fixture.state.runDir, 'gate-hashes-1.json'))).toBe(true)

    const gateEvents = readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
      (e): e is Extract<SddEvent, { type: 'gate' }> => e.type === 'gate',
    )
    expect(gateEvents).toHaveLength(1)
    expect(gateEvents[0]).toMatchObject({ action: 'presented', mode: 'plan', version: 1 })

    expect(fixture.state.status).toBe('running')
    expect(fixture.state.gate).toEqual({ mode: 'plan', version: 1 })
    expect(fixture.state.autoExtendsUsed).toBe(0)
  })

  it('a fired R4 writes the preview block, auto-policy.jsonl line, and auto_decision event with attribution', async () => {
    const fixture = await makePlanFixture({ level: 'assist', costCeilingUsd: 1 })
    const result = await presentGateAt(fixture.deps, fixture.state, fixture.ctx, CONVERGED, 1, 'plan', {
      children: PLAN_CHILDREN,
    })
    expect(result.halted).toBe('gate')

    const md = fs.readFileSync(result.gateMdPath, 'utf8')
    expect(md).toContain('### Auto-decision preview')
    expect(md).toContain('> rule: R4')

    const sidecarLine = fs.readFileSync(path.join(fixture.state.runDir, 'auto-policy.jsonl'), 'utf8').trim()
    expect(sidecarLine.includes('\n')).toBe(false)
    expect(JSON.parse(sidecarLine)).toMatchObject({ gateVersion: 1, rule: 'R4', decision: 'gate' })

    const autoDecisions = readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
      (e) => e.type === 'auto_decision',
    )
    expect(autoDecisions).toHaveLength(1)
    expect(autoDecisions[0]).toMatchObject({ rule: 'R4', decision: 'gate', gateVersion: 1 })
  })

  it('under-ceiling plan spend records rule none and still presents to the human', async () => {
    const fixture = await makePlanFixture()
    await presentGateAt(fixture.deps, fixture.state, fixture.ctx, CONVERGED, 1, 'plan', {
      children: PLAN_CHILDREN,
    })
    const autoDecisions = readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
      (e) => e.type === 'auto_decision',
    )
    expect(autoDecisions[0]).toMatchObject({ rule: 'none', decision: 'gate' })
    expect(fixture.state.status).toBe('running')
  })
})

describe('buildBus subscriber wiring', () => {
  const event = { altitude: 'L2' as const, type: 'round_open' as const, round: 1, cap: 3 }

  function makeDeps(lines: string[], overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
    return {
      config: { repoRoot: '/tmp', workDir: '/tmp/.sdd-runner', model: 'm', budget: 5 },
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: createOpenSpecDriver({
        exec: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        cwd: '/tmp',
      }),
      stdout: (line: string): void => {
        lines.push(line)
      },
      ...overrides,
    }
  }

  it('appends events to the log and prefers liveEvents over render exclusively', () => {
    const dir = makeDir()
    const logPath = path.join(dir, 'runs', 'r1', 'events.ndjson')
    const rendered: string[] = []
    const lived: unknown[] = []
    const deps = makeDeps([], {
      render: (e: { type: string }): void => {
        rendered.push(e.type)
      },
      liveEvents: (e: unknown): void => {
        lived.push(e)
      },
    })
    buildBus(deps, logPath)(event)
    expect(fs.readFileSync(logPath, 'utf8')).toContain('"type":"round_open"')
    expect(lived).toHaveLength(1)
    expect(rendered).toEqual([])
  })

  it('routes to render when no liveEvents sink is wired', () => {
    const dir = makeDir()
    const logPath = path.join(dir, 'runs', 'r2', 'events.ndjson')
    const rendered: string[] = []
    const deps = makeDeps([], {
      render: (e: { type: string }): void => {
        rendered.push(e.type)
      },
    })
    buildBus(deps, logPath)(event)
    expect(rendered).toEqual(['round_open'])
  })

  it('reports a throwing subscriber on stdout with the event-bus prefix', () => {
    const dir = makeDir()
    const lines: string[] = []
    const deps = makeDeps(lines, {
      liveEvents: (): void => {
        throw new Error('sink exploded')
      },
    })
    expect(() => buildBus(deps, path.join(dir, 'events.ndjson'))(event)).not.toThrow()
    expect(lines).toEqual(['[event-bus] sink exploded'])
  })
})
