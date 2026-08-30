// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Finding, Resolution } from '../../sdd-runner/src/agent-layer.js'
import { analyzeRun, buildCorpusReport } from '../../sdd-runner/src/analyze-corpus.js'
import {
  classChurn,
  concernPersistence,
  duplicateIdRate,
  lensOverlapRate,
  r2EligibilityRate,
  resolverActionMix,
} from '../../sdd-runner/src/analyze-findings.js'
import { decisionConsistency, gateForensics } from '../../sdd-runner/src/analyze-gates.js'
import type { AnalyzeFs, AnalyzeGit, GateFileRecord, RunBundle } from '../../sdd-runner/src/analyze-io.js'
import { loadRunBundle, nodeAnalyzeFs, readOnlyGit } from '../../sdd-runner/src/analyze-io.js'
import { renderCorpusJson, renderCorpusReport } from '../../sdd-runner/src/analyze-report.js'
import type { ChangeGroundTruth } from '../../sdd-runner/src/analyze-truth.js'
import { groundTruthJoin } from '../../sdd-runner/src/analyze-truth.js'
import type { Metric } from '../../sdd-runner/src/analyze.js'
import { retryTaxonomy, trajectoryMetric } from '../../sdd-runner/src/analyze.js'
import type { EventInput, SddEvent } from '../../sdd-runner/src/events.js'
import { stampEvent } from '../../sdd-runner/src/events.js'
import type { PersistedRunState } from '../../sdd-runner/src/run-state.js'

const dirs: string[] = []
function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdd-analyze-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Type-level no-write pin (D2): if `AnalyzeFs` ever grows a write-capable
 * member this union stops being `never` and the call below fails the
 * typecheck. The runtime key set is pinned separately in the seam test.
 */
type WRITE_CAPABLE_FS_KEYS =
  | 'writeFile'
  | 'appendFile'
  | 'rm'
  | 'mkdir'
  | 'rmdir'
  | 'rename'
  | 'unlink'
  | 'cp'
  | 'write'
  | 'createWriteStream'
type PresentWriteKeys = Extract<keyof AnalyzeFs, WRITE_CAPABLE_FS_KEYS>
/** If AnalyzeFs ever grows a write member this type stops being `true` and the return below fails to typecheck. */
type NoWriteMembers = PresentWriteKeys extends never ? true : never

function pinNoWriteMembers(): true {
  const noWriteMembers: NoWriteMembers = true
  return noWriteMembers
}

describe('read-only IO seam (1.1)', () => {
  it('the injected fs exposes only readFile/readdir/stat — no write members', () => {
    expect(pinNoWriteMembers()).toBe(true)
    expect(Object.keys(nodeAnalyzeFs()).sort()).toEqual(['readFile', 'readdir', 'stat'])
  })

  it('the git wrapper allows log and ls-tree and rejects every other subcommand', async () => {
    const seen: string[][] = []
    const fake: AnalyzeGit = (_cwd, args) => {
      seen.push([...args])
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    const guarded = readOnlyGit(fake)
    await guarded('/repo', ['log', '--pretty=format:%h %s'])
    await guarded('/repo', ['ls-tree', 'master', 'openspec/changes/kb'])
    await expect(guarded('/repo', ['status'])).rejects.toThrow(/read-only.*status/u)
    await expect(guarded('/repo', ['push', 'origin', 'master'])).rejects.toThrow(/read-only.*push/u)
    await expect(guarded('/repo', [])).rejects.toThrow(/read-only/u)
    expect(seen).toEqual([
      ['log', '--pretty=format:%h %s'],
      ['ls-tree', 'master', 'openspec/changes/kb'],
    ])
  })
})

describe('run loading (1.2)', () => {
  it('loads a full run bundle: state, events, sidecars, gate files, expiry claims', async () => {
    const workDir = makeDir()
    const runDir = path.join(workDir, 'runs', 'modern-run')
    seedState(runDir, { runId: 'modern-run', changeName: 'fix-command', status: 'completed' })
    writeFileSync(
      path.join(runDir, 'events.ndjson'),
      [
        { altitude: 'L2', type: 'round_open', round: 1, cap: 3, seq: 1, ts: '2026-08-23T19:41:00.000Z' },
        {
          altitude: 'L2',
          type: 'finding',
          action: 'filed',
          id: 'F1',
          round: 1,
          class: 'MATERIAL',
          seq: 2,
          ts: '2026-08-23T19:42:00.000Z',
        },
        {
          altitude: 'L2',
          type: 'convergence',
          round: 1,
          verdict: 'open',
          counts: { blocker: 0, material: 2, nitpick: 1 },
          seq: 3,
          ts: '2026-08-23T19:43:00.000Z',
        },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n')
        .concat('\n'),
    )
    const sidecars = path.join(runDir, 'sidecars')
    mkdirSync(sidecars, { recursive: true })
    writeFileSync(
      path.join(sidecars, 'findings-1.json'),
      JSON.stringify({
        findings: [
          {
            id: 'F1',
            class: 'MATERIAL',
            gap: 'the design asserts X',
            question: 'why?',
            code_evidence_attempted: 'checked',
          },
        ],
      }),
    )
    writeFileSync(
      path.join(sidecars, 'resolutions-1.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'fixed' }],
      }),
    )
    writeFileSync(path.join(runDir, 'gate-1.md'), '## Gate response\n')
    writeFileSync(path.join(runDir, 'gate-1.expiry-claim'), '2026-08-23T20:00:00.000Z\n')

    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'modern-run')

    expect(bundle.state?.changeName).toBe('fix-command')
    expect(bundle.events.map((event) => event.type)).toEqual(['round_open', 'finding', 'convergence'])
    expect(bundle.droppedEventLines).toBe(0)
    expect(bundle.findings).toHaveLength(1)
    expect(bundle.findings[0]?.items[0]?.id).toBe('F1')
    expect(bundle.resolutions).toHaveLength(1)
    expect(bundle.gateFiles).toEqual([{ version: 1, md: '## Gate response\n' }])
    expect(bundle.expiryClaimVersions).toEqual([1])
    expect(bundle.stateBak).toBe(false)
  })

  it('a pre-skeptic-era run loads with reduced coverage instead of failing', async () => {
    const workDir = makeDir()
    const runDir = path.join(workDir, 'runs', 'legacy-run')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      path.join(runDir, 'events.ndjson'),
      [
        JSON.stringify({
          altitude: 'L2',
          type: 'depth',
          profile: 'S',
          rationale: 'small',
          source: 'override',
          seq: 1,
          ts: '2026-08-01T00:00:00.000Z',
        }),
        // an event vocabulary the current schema does not know: dropped, not fatal
        JSON.stringify({ altitude: 'L9', type: 'legacy_thing', seq: 2, ts: '2026-08-01T00:00:01.000Z' }),
      ]
        .join('\n')
        .concat('\n'),
    )

    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'legacy-run')

    expect(bundle.state).toBeNull()
    expect(bundle.events).toHaveLength(1)
    expect(bundle.droppedEventLines).toBe(1)
    expect(bundle.findings).toEqual([])
    expect(bundle.resolutions).toEqual([])
    expect(bundle.gateFiles).toEqual([])
  })

  it('a corrupt sidecar counts as a parse failure and the rest of the bundle still loads', async () => {
    const workDir = makeDir()
    const runDir = path.join(workDir, 'runs', 'partial-run')
    mkdirSync(runDir, { recursive: true })
    const sidecars = path.join(runDir, 'sidecars')
    mkdirSync(sidecars, { recursive: true })
    writeFileSync(path.join(sidecars, 'findings-1.json'), '{not json')
    writeFileSync(
      path.join(sidecars, 'resolutions-1.json'),
      JSON.stringify({ resolutions: [{ id: 'F2', class: 'NITPICK', resolution: 'dismissed', justification: 'dup' }] }),
    )

    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'partial-run')

    expect(bundle.findings).toEqual([])
    expect(bundle.resolutions).toHaveLength(1)
    expect(bundle.sidecarFailures).toBe(1)
  })
})

/** Minimal state.json seeder shared by the loading fixtures. */
function seedState(runDir: string, overrides: { runId: string; changeName: string; status: string }): void {
  mkdirSync(runDir, { recursive: true })
  const now = '2026-08-23T19:40:00.000Z'
  writeFileSync(
    path.join(runDir, 'state.json'),
    JSON.stringify({
      runId: overrides.runId,
      repoRoot: path.dirname(path.dirname(runDir)),
      workDir: path.dirname(runDir),
      changeName: overrides.changeName,
      stage: 'gate',
      depth: 'M',
      round: 1,
      gate: null,
      status: overrides.status,
      createdAt: now,
      updatedAt: now,
      autoExtendsUsed: 0,
      gateDeadlineAt: null,
      gateDeadlineReArmed: false,
    }),
  )
}

const T0 = '2026-08-23T19:40:00.000Z'
const at = (minutes: number): string => new Date(new Date(T0).getTime() + minutes * 60_000).toISOString()
const ev = (init: EventInput, seq: number, ts: string): SddEvent => stampEvent(init, seq, ts)

const roundOpen = (round: number, cap: number): EventInput => ({ altitude: 'L2', type: 'round_open', round, cap })
const convergenceOf = (
  round: number,
  verdict: 'converged' | 'open',
  counts: { blocker: number; material: number; nitpick: number },
): EventInput => ({ altitude: 'L2', type: 'convergence', round, verdict, counts })
const gatePresented = (version: number, mode: 'early' | 'final' | 'plan'): EventInput => ({
  altitude: 'L2',
  type: 'gate',
  action: 'presented',
  mode,
  version,
})
const gateAnswered = (version: number, mode: 'early' | 'final' | 'plan'): EventInput => ({
  altitude: 'L2',
  type: 'gate',
  action: 'answered',
  mode,
  version,
})
const autoDecision = (
  rule: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'none',
  decision: 'preview' | 'approve' | 'extend' | 'accept-items' | 'gate' | 'pending',
  version: number,
): EventInput => ({
  altitude: 'L2',
  type: 'auto_decision',
  rule,
  decision,
  evidenceDigest: 'digest',
  gateVersion: version,
})
const spawnedAs = (agent: string, role: string): EventInput => ({
  altitude: 'L1',
  type: 'spawned',
  agent,
  role,
  model: 'model-x',
})
const retryingAs = (agent: string, reason: 'stall' | 'validation', attempt: number): EventInput => ({
  altitude: 'L1',
  type: 'retrying',
  agent,
  reason,
  attempt,
})
const findingEvent = (
  round: number,
  id: string,
  action: 'filed' | 'classified' | 'resolved' | 'dismissed',
  klass?: 'BLOCKER' | 'MATERIAL' | 'NITPICK',
  fingerprint?: string,
): EventInput => ({
  altitude: 'L2',
  type: 'finding',
  action,
  id,
  round,
  ...(klass === undefined ? {} : { class: klass }),
  ...(fingerprint === undefined ? {} : { fingerprint }),
})

const findingOf = (id: string, gap: string, klass: Finding['class'] = 'MATERIAL'): Finding => ({
  id,
  class: klass,
  gap,
  question: `${id}?`,
  code_evidence_attempted: 'checked the repo',
})
const resolutionOf = (
  id: string,
  klass: Finding['class'] = 'NITPICK',
  action: Resolution['resolution'] = 'edited',
): Resolution => ({
  id,
  class: klass,
  resolution: action,
  ...(action === 'dismissed' ? { justification: 'duplicate' } : { outcome: 'done' }),
})

const doneAs = (agent: string, costUsd: number): EventInput => ({
  altitude: 'L1',
  type: 'done',
  agent,
  usage: {
    inputTokens: 1000,
    outputTokens: 200,
    reasoningTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    costUsd,
    wallMs: 60_000,
  },
})

function stateOf(overrides: Partial<PersistedRunState>): PersistedRunState {
  return {
    runId: 'r',
    repoRoot: '/repo',
    workDir: '/w',
    changeName: 'thing',
    stage: 'gate',
    depth: 'M',
    round: 1,
    gate: null,
    status: 'completed',
    createdAt: T0,
    updatedAt: T0,
    autoExtendsUsed: 0,
    gateDeadlineAt: null,
    gateDeadlineReArmed: false,
    ...overrides,
  }
}

interface BundleSeed {
  readonly workDir?: string
  readonly runId?: string
  readonly events?: readonly SddEvent[]
  readonly findings?: readonly { readonly round: number; readonly items: readonly Finding[] }[]
  readonly skeptic?: readonly { readonly round: number; readonly items: readonly Finding[] }[]
  readonly resolutions?: readonly { readonly round: number; readonly items: readonly Resolution[] }[]
  readonly gateFiles?: readonly GateFileRecord[]
  readonly expiryClaims?: readonly number[]
  readonly state?: PersistedRunState | null
  readonly stateBak?: boolean
}

function bundleOf(seed: BundleSeed = {}): RunBundle {
  return {
    workDir: seed.workDir ?? '/w',
    runId: seed.runId ?? 'r',
    runDir: `${seed.workDir ?? '/w'}/runs/${seed.runId ?? 'r'}`,
    state: seed.state === undefined ? null : seed.state,
    stateBak: seed.stateBak ?? false,
    events: seed.events ?? [],
    droppedEventLines: 0,
    findings: seed.findings ?? [],
    skepticFindings: seed.skeptic ?? [],
    resolutions: seed.resolutions ?? [],
    gateFiles: seed.gateFiles ?? [],
    expiryClaimVersions: seed.expiryClaims ?? [],
    sidecarFailures: 0,
  }
}

function knownValue<T>(metric: Metric<T>): T {
  if (metric.status !== 'known') throw new Error(`expected a known metric, got unknown: ${metric.reason}`)
  return metric.value
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {}
}

function arrayField(record: Readonly<Record<string, unknown>>, key: string): readonly unknown[] {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

describe('trajectory and gate forensics (2.1)', () => {
  it('folds per-round class counts, verdicts, and resolved/dismissed tallies', () => {
    const bundle = bundleOf({
      events: [
        ev(roundOpen(1, 3), 1, at(0)),
        ev(findingEvent(1, 'F1', 'resolved', 'MATERIAL'), 2, at(1)),
        ev(findingEvent(1, 'F2', 'dismissed', 'NITPICK'), 3, at(2)),
        ev(convergenceOf(1, 'open', { blocker: 1, material: 2, nitpick: 1 }), 4, at(3)),
        ev(roundOpen(2, 3), 5, at(4)),
        ev(convergenceOf(2, 'converged', { blocker: 0, material: 0, nitpick: 2 }), 6, at(5)),
      ],
    })
    const rounds = knownValue(trajectoryMetric(bundle))
    expect(rounds).toHaveLength(2)
    expect(rounds[0]).toMatchObject({ round: 1, verdict: 'open', resolved: 1, dismissed: 1 })
    expect(rounds[0]?.counts).toEqual({ blocker: 1, material: 2, nitpick: 1 })
    expect(rounds[1]).toMatchObject({ round: 2, verdict: 'converged', resolved: 0, dismissed: 0 })
  })

  it('trajectory is unknown for a run that never reached review', () => {
    expect(trajectoryMetric(bundleOf()).status).toBe('unknown')
  })

  it('gate latency: answered gates carry presented→answered ms; never-answered carry age', () => {
    const now = new Date(at(60))
    const bundle = bundleOf({
      events: [
        ev(gatePresented(1, 'final'), 1, at(0)),
        ev(gateAnswered(1, 'final'), 2, at(5)),
        ev(gatePresented(2, 'final'), 3, at(10)),
      ],
    })
    const forensics = knownValue(gateForensics(bundle, now))
    expect(forensics.answered).toEqual([
      { version: 1, mode: 'final', latencyMs: 5 * 60_000, settledBy: 'human', rule: null },
    ])
    expect(forensics.neverAnswered).toEqual([{ version: 2, mode: 'final', ageMs: 50 * 60_000 }])
  })

  it('gate forensics attributes policy extends, waiter settles, and human extends', () => {
    const bundle = bundleOf({
      events: [
        ev(gatePresented(1, 'final'), 1, at(0)),
        ev(autoDecision('R2', 'extend', 1), 2, at(1)),
        ev(gatePresented(2, 'final'), 3, at(5)),
        ev(gateAnswered(2, 'final'), 4, at(6)),
        ev(autoDecision('R1', 'approve', 2), 5, at(6)),
        ev(gatePresented(3, 'final'), 6, at(10)),
        ev(gateAnswered(3, 'final'), 7, at(12)),
      ],
      gateFiles: [{ version: 3, md: '→ RUN 1 MORE\n' }],
      expiryClaims: [2],
    })
    const forensics = knownValue(gateForensics(bundle, new Date(at(30))))
    expect(forensics.extends).toEqual([
      { version: 1, origin: 'policy', rule: 'R2' },
      { version: 3, origin: 'human', rule: null },
    ])
    expect(forensics.answered.find((entry) => entry.version === 2)).toMatchObject({
      settledBy: 'waiter',
      rule: 'R1',
    })
    expect(forensics.answered.find((entry) => entry.version === 3)).toMatchObject({ settledBy: 'human' })
    expect(forensics.autoDecisionsByRule).toEqual({ R1: 1, R2: 1 })
  })

  it('retry taxonomy counts stall vs validation per role', () => {
    const bundle = bundleOf({
      events: [
        ev(spawnedAs('a1', 'drafter'), 1, at(0)),
        ev(spawnedAs('a2', 'reviewer'), 2, at(0)),
        ev(retryingAs('a1', 'stall', 1), 3, at(1)),
        ev(retryingAs('a1', 'stall', 2), 4, at(2)),
        ev(retryingAs('a2', 'validation', 1), 5, at(3)),
      ],
    })
    expect(knownValue(retryTaxonomy(bundle))).toEqual({
      drafter: { stall: 2, validation: 0 },
      reviewer: { stall: 0, validation: 1 },
    })
  })

  it('retry taxonomy is unknown without an event log', () => {
    expect(retryTaxonomy(bundleOf()).status).toBe('unknown')
  })
})

describe('finding lifecycle (2.2)', () => {
  it('duplicateIdRate: ids repeated within one round ledger (fix-command r3 dup fixture)', () => {
    const bundle = bundleOf({
      resolutions: [
        { round: 2, items: [resolutionOf('F1', 'MATERIAL'), resolutionOf('F2', 'NITPICK')] },
        {
          round: 3,
          items: [
            resolutionOf('F1', 'MATERIAL'),
            resolutionOf('F2', 'NITPICK'),
            resolutionOf('F3', 'NITPICK'),
            resolutionOf('F1', 'MATERIAL'),
          ],
        },
      ],
    })
    expect(knownValue(duplicateIdRate(bundle))).toBeCloseTo(1 / 6)
  })

  it('duplicateIdRate is unknown for a pre-skeptic-era run without sidecars', () => {
    expect(duplicateIdRate(bundleOf({ events: [ev(roundOpen(1, 1), 1, at(0))] })).status).toBe('unknown')
  })

  it('lensOverlapRate: skeptic findings matching same-round reviewer gaps', () => {
    const gap = 'the design asserts X without evidence'
    const bundle = bundleOf({
      findings: [{ round: 3, items: [findingOf('F1', gap), findingOf('F2', 'an unrelated gap')] }],
      skeptic: [{ round: 3, items: [findingOf('S1', gap), findingOf('S2', 'a skeptic-only gap')] }],
    })
    expect(knownValue(lensOverlapRate(bundle))).toBeCloseTo(0.5)
  })

  it('lensOverlapRate is unknown without skeptic sidecars', () => {
    expect(lensOverlapRate(bundleOf({ findings: [{ round: 3, items: [findingOf('F1', 'gap')] }] })).status).toBe(
      'unknown',
    )
  })

  it('classChurn: ids whose class changed across rounds over multi-round ids', () => {
    const bundle = bundleOf({
      findings: [
        { round: 1, items: [findingOf('F1', 'gap one', 'MATERIAL'), findingOf('F2', 'gap two', 'NITPICK')] },
        { round: 2, items: [findingOf('F1', 'gap one', 'BLOCKER'), findingOf('F2', 'gap two', 'NITPICK')] },
      ],
    })
    expect(knownValue(classChurn(bundle))).toBeCloseTo(1 / 2)
  })

  it('classChurn is unknown when no id spans multiple rounds', () => {
    expect(classChurn(bundleOf({ findings: [{ round: 1, items: [findingOf('F1', 'gap')] }] })).status).toBe('unknown')
  })

  it('resolverActionMix over the resolutions ledger', () => {
    const bundle = bundleOf({
      resolutions: [
        {
          round: 1,
          items: [resolutionOf('F1', 'MATERIAL', 'edited'), resolutionOf('F2', 'NITPICK', 'dismissed')],
        },
        {
          round: 2,
          items: [
            resolutionOf('F3', 'NITPICK', 'evidence-answered'),
            resolutionOf('F4', 'NITPICK', 'assumed'),
            resolutionOf('F5', 'MATERIAL', 'edited'),
          ],
        },
      ],
    })
    expect(knownValue(resolverActionMix(bundle))).toEqual({
      edited: 2,
      dismissed: 1,
      'evidence-answered': 1,
      assumed: 1,
    })
  })
})

describe('concern persistence and R2 eligibility (2.3)', () => {
  it('concernPersistence: clusters spanning ≥2 rounds over distinct concerns (sidecar gaps)', () => {
    const bundle = bundleOf({
      findings: [
        { round: 1, items: [findingOf('F1', 'the same concern text'), findingOf('F2', 'a one-off concern')] },
        { round: 2, items: [findingOf('F3', 'the same concern text')] },
      ],
    })
    expect(knownValue(concernPersistence(bundle))).toBeCloseTo(1 / 2)
  })

  it('concernPersistence folds fingerprinted finding events when sidecars are absent', () => {
    const bundle = bundleOf({
      events: [
        ev(findingEvent(1, 'F1', 'filed', 'MATERIAL', 'fp-x'), 1, at(0)),
        ev(findingEvent(2, 'F1', 'filed', 'MATERIAL', 'fp-x'), 2, at(1)),
        ev(findingEvent(2, 'F2', 'filed', 'NITPICK', 'fp-y'), 3, at(2)),
      ],
    })
    expect(knownValue(concernPersistence(bundle))).toBeCloseTo(1 / 2)
  })

  it('concernPersistence is unknown with neither findings sidecars nor fingerprints', () => {
    expect(concernPersistence(bundleOf()).status).toBe('unknown')
  })

  it('r2EligibilityRate: cap-hit gate states with decreasing blocker-free trajectories', () => {
    const bundle = bundleOf({
      events: [
        ev(roundOpen(1, 3), 1, at(0)),
        ev(convergenceOf(1, 'open', { blocker: 0, material: 3, nitpick: 2 }), 2, at(1)),
        ev(roundOpen(2, 3), 3, at(2)),
        ev(convergenceOf(2, 'open', { blocker: 0, material: 4, nitpick: 1 }), 4, at(3)),
        ev(roundOpen(3, 3), 5, at(4)),
        ev(convergenceOf(3, 'open', { blocker: 0, material: 2, nitpick: 1 }), 6, at(5)),
        ev(gatePresented(1, 'early'), 7, at(6)),
        ev(autoDecision('R2', 'extend', 1), 8, at(6)),
      ],
    })
    expect(knownValue(r2EligibilityRate(bundle))).toEqual({
      eligible: 1,
      gateStates: 1,
      byCause: { 'r2-fired': 1 },
    })
  })

  it('r2EligibilityRate: open blockers or a non-decreasing trajectory make the state ineligible', () => {
    const withBlocker = bundleOf({
      events: [
        ev(roundOpen(1, 2), 1, at(0)),
        ev(convergenceOf(1, 'open', { blocker: 0, material: 3, nitpick: 0 }), 2, at(1)),
        ev(roundOpen(2, 2), 3, at(2)),
        ev(convergenceOf(2, 'open', { blocker: 1, material: 2, nitpick: 0 }), 4, at(3)),
      ],
    })
    const nonDecreasing = bundleOf({
      events: [
        ev(roundOpen(1, 2), 1, at(0)),
        ev(convergenceOf(1, 'open', { blocker: 0, material: 2, nitpick: 0 }), 2, at(1)),
        ev(roundOpen(2, 2), 3, at(2)),
        ev(convergenceOf(2, 'open', { blocker: 0, material: 3, nitpick: 1 }), 4, at(3)),
      ],
    })
    expect(knownValue(r2EligibilityRate(withBlocker))).toEqual({
      eligible: 0,
      gateStates: 1,
      byCause: { 'trajectory-blocked': 1 },
    })
    expect(knownValue(r2EligibilityRate(nonDecreasing))).toEqual({
      eligible: 0,
      gateStates: 1,
      byCause: { 'trajectory-blocked': 1 },
    })
  })

  it('r2EligibilityRate is unknown without cap-hit convergence pairs', () => {
    const converged = bundleOf({
      events: [
        ev(roundOpen(1, 3), 1, at(0)),
        ev(convergenceOf(1, 'converged', { blocker: 0, material: 0, nitpick: 1 }), 2, at(1)),
      ],
    })
    expect(r2EligibilityRate(converged).status).toBe('unknown')
    expect(r2EligibilityRate(bundleOf()).status).toBe('unknown')
  })
})

describe('r2 blocking-cause attribution (sdd-analyze-r2-blocking-cause)', () => {
  /** One eligible cap-hit state (r2) joined by an early gate carrying the given decision. */
  const eligibleStateWith = (version: number, decision: EventInput): SddEvent[] => [
    ev(roundOpen(1, 2), 1, at(0)),
    ev(convergenceOf(1, 'open', { blocker: 0, material: 3, nitpick: 1 }), 2, at(1)),
    ev(roundOpen(2, 2), 3, at(2)),
    ev(convergenceOf(2, 'open', { blocker: 0, material: 2, nitpick: 1 }), 4, at(3)),
    ev(gatePresented(version, 'early'), 5, at(4)),
    ev(decision, 6, at(5)),
  ]

  it('an extend auto_decision naming R2 attributes r2-fired', () => {
    const bundle = bundleOf({ events: eligibleStateWith(1, autoDecision('R2', 'extend', 1)) })
    expect(knownValue(r2EligibilityRate(bundle))).toEqual({
      eligible: 1,
      gateStates: 1,
      byCause: { 'r2-fired': 1 },
    })
  })

  it('an R4 presentation attributes cost-unknown on a cost-unknown run and over-ceiling on a cost-known one', () => {
    const r4Gate = autoDecision('R4', 'gate', 1)
    expect(knownValue(r2EligibilityRate(bundleOf({ events: eligibleStateWith(1, r4Gate) }), false))).toEqual({
      eligible: 1,
      gateStates: 1,
      byCause: { 'cost-unknown': 1 },
    })
    expect(knownValue(r2EligibilityRate(bundleOf({ events: eligibleStateWith(1, r4Gate) }), true))).toEqual({
      eligible: 1,
      gateStates: 1,
      byCause: { 'over-ceiling': 1 },
    })
  })

  it('a preview auto_decision attributes preview, distinct from r2-fired', () => {
    const bundle = bundleOf({ events: eligibleStateWith(1, autoDecision('R2', 'preview', 1)) })
    expect(knownValue(r2EligibilityRate(bundle))).toEqual({
      eligible: 1,
      gateStates: 1,
      byCause: { preview: 1 },
    })
  })

  it('an ineligible state is trajectory-blocked even when R4 named its gate (the complement bucket)', () => {
    const bundle = bundleOf({
      events: [
        ev(roundOpen(1, 2), 1, at(0)),
        ev(convergenceOf(1, 'open', { blocker: 0, material: 3, nitpick: 1 }), 2, at(1)),
        ev(roundOpen(2, 2), 3, at(2)),
        ev(convergenceOf(2, 'open', { blocker: 1, material: 2, nitpick: 0 }), 4, at(3)),
        ev(gatePresented(1, 'early'), 5, at(4)),
        ev(autoDecision('R4', 'gate', 1), 6, at(5)),
      ],
    })
    expect(knownValue(r2EligibilityRate(bundle, false))).toEqual({
      eligible: 0,
      gateStates: 1,
      byCause: { 'trajectory-blocked': 1 },
    })
  })

  it('the join takes the first early presentation after the convergence; final-gate records never join', () => {
    const bundle = bundleOf({
      events: [
        ev(roundOpen(1, 2), 1, at(0)),
        ev(convergenceOf(1, 'open', { blocker: 0, material: 4, nitpick: 1 }), 2, at(1)),
        ev(roundOpen(2, 2), 3, at(2)),
        ev(convergenceOf(2, 'open', { blocker: 0, material: 3, nitpick: 1 }), 4, at(3)),
        ev(gatePresented(1, 'final'), 5, at(6)),
        ev(autoDecision('R2', 'extend', 1), 6, at(6)),
        ev(gatePresented(2, 'early'), 7, at(7)),
        ev(autoDecision('R4', 'gate', 2), 8, at(8)),
        ev(roundOpen(3, 3), 9, at(9)),
        ev(convergenceOf(3, 'open', { blocker: 0, material: 2, nitpick: 1 }), 10, at(10)),
        ev(gatePresented(3, 'early'), 11, at(11)),
        ev(autoDecision('R2', 'extend', 3), 12, at(12)),
      ],
    })
    expect(knownValue(r2EligibilityRate(bundle, false))).toEqual({
      eligible: 2,
      gateStates: 2,
      byCause: { 'r2-fired': 1, 'cost-unknown': 1 },
    })
  })

  it('an era run with an eligible state but no supporting records degrades to unknown with its reason', () => {
    const era = bundleOf({
      events: [
        ev(roundOpen(1, 2), 1, at(0)),
        ev(convergenceOf(1, 'open', { blocker: 0, material: 3, nitpick: 1 }), 2, at(1)),
        ev(roundOpen(2, 2), 3, at(2)),
        ev(convergenceOf(2, 'open', { blocker: 0, material: 2, nitpick: 1 }), 4, at(3)),
      ],
    })
    const metric = r2EligibilityRate(era)
    expect(metric).toEqual({
      status: 'unknown',
      reason: 'no gate/auto-decision records for 1 eligible cap-hit state(s)',
    })
  })

  it('an era run whose states all fail the predicate stays known on the trajectory-blocked complement', () => {
    const era = bundleOf({
      events: [
        ev(roundOpen(1, 2), 1, at(0)),
        ev(convergenceOf(1, 'open', { blocker: 2, material: 1, nitpick: 0 }), 2, at(1)),
        ev(roundOpen(2, 2), 3, at(2)),
        ev(convergenceOf(2, 'open', { blocker: 1, material: 1, nitpick: 1 }), 4, at(3)),
        ev(roundOpen(3, 3), 5, at(4)),
        ev(convergenceOf(3, 'open', { blocker: 2, material: 0, nitpick: 1 }), 6, at(5)),
      ],
    })
    expect(knownValue(r2EligibilityRate(era))).toEqual({
      eligible: 0,
      gateStates: 2,
      byCause: { 'trajectory-blocked': 2 },
    })
  })

  it('a kiss-help-style preview pair attributes preview ×2', () => {
    const bundle = bundleOf({
      events: [
        ev(roundOpen(1, 2), 1, at(0)),
        ev(convergenceOf(1, 'open', { blocker: 1, material: 10, nitpick: 0 }), 2, at(1)),
        ev(roundOpen(2, 2), 3, at(2)),
        ev(convergenceOf(2, 'open', { blocker: 0, material: 6, nitpick: 1 }), 4, at(3)),
        ev(gatePresented(2, 'early'), 5, at(4)),
        ev(autoDecision('R2', 'preview', 2), 6, at(5)),
        ev(roundOpen(3, 3), 7, at(6)),
        ev(convergenceOf(3, 'open', { blocker: 0, material: 4, nitpick: 2 }), 8, at(7)),
        ev(gatePresented(5, 'early'), 9, at(8)),
        ev(autoDecision('R2', 'preview', 5), 10, at(9)),
      ],
    })
    expect(knownValue(r2EligibilityRate(bundle))).toEqual({
      eligible: 2,
      gateStates: 2,
      byCause: { preview: 2 },
    })
  })

  it('cost-unknown extend-by-human rows attribute cost-unknown', () => {
    const bundle = bundleOf({
      events: [...eligibleStateWith(1, autoDecision('R4', 'gate', 1)), ev(gateAnswered(1, 'early'), 7, at(30))],
      gateFiles: [{ version: 1, md: '→ RUN 1 MORE\n' }],
    })
    expect(knownValue(r2EligibilityRate(bundle, false))).toEqual({
      eligible: 1,
      gateStates: 1,
      byCause: { 'cost-unknown': 1 },
    })
  })
})

describe('decision-record consistency (2.4)', () => {
  const responded = '## Gate response\n\n- [x] F13 F13\n'

  it('the trilogy signature: phantom answers and .bak residue mark the run era-contaminated', () => {
    const bundle = bundleOf({
      state: stateOf({ status: 'completed' }),
      stateBak: true,
      events: [
        ev(gatePresented(1, 'early'), 1, at(0)),
        ev(gateAnswered(1, 'early'), 2, at(10)),
        ev(gateAnswered(2, 'final'), 3, at(20)),
        ev(gateAnswered(3, 'final'), 4, at(30)),
        ev(gateAnswered(4, 'final'), 5, at(40)),
        ev(gateAnswered(5, 'final'), 6, at(50)),
        ev(gatePresented(6, 'final'), 7, at(60)),
        ev(autoDecision('R1', 'approve', 6), 8, at(70)),
        ev(gateAnswered(6, 'final'), 9, at(70)),
      ],
      gateFiles: [
        { version: 1, md: 'ABORT\n' },
        { version: 2, md: responded },
        { version: 3, md: responded },
        { version: 4, md: responded },
        { version: 5, md: 'ABORT\n' },
        { version: 6, md: responded },
      ],
      expiryClaims: [6],
    })
    const audit = decisionConsistency(bundle)
    expect(audit.answeredWithoutPresented).toEqual([2, 3, 4, 5])
    expect(audit.bakResidue).toBe(true)
    expect(audit.completedAfterUnsupersededAbort).toBe(false)
    expect(audit.gateFilesWithoutAnsweredEvent).toEqual([])
    expect(audit.eraContaminated).toBe(true)
  })

  it('completion after an unsuperseded ABORT is flagged for manual review', () => {
    const bundle = bundleOf({
      state: stateOf({ status: 'completed' }),
      events: [
        ev(gatePresented(1, 'final'), 1, at(0)),
        ev(gateAnswered(1, 'final'), 2, at(5)),
        ev(gatePresented(2, 'final'), 3, at(10)),
        ev(gateAnswered(2, 'final'), 4, at(15)),
      ],
      gateFiles: [
        { version: 1, md: responded },
        { version: 2, md: 'ABORT\n' },
      ],
    })
    const audit = decisionConsistency(bundle)
    expect(audit.completedAfterUnsupersededAbort).toBe(true)
    expect(audit.eraContaminated).toBe(true)
  })

  it('a consistent run raises no flags and stays out of era-contaminated aggregates', () => {
    const bundle = bundleOf({
      state: stateOf({ status: 'completed' }),
      events: [ev(gatePresented(1, 'final'), 1, at(0)), ev(gateAnswered(1, 'final'), 2, at(5))],
      gateFiles: [{ version: 1, md: responded }],
    })
    const audit = decisionConsistency(bundle)
    expect(audit.answeredWithoutPresented).toEqual([])
    expect(audit.completedAfterUnsupersededAbort).toBe(false)
    expect(audit.bakResidue).toBe(false)
    expect(audit.gateFilesWithoutAnsweredEvent).toEqual([])
    expect(audit.eraContaminated).toBe(false)
  })

  it('a decision-carrying gate file without an answered event is flagged', () => {
    const bundle = bundleOf({
      state: stateOf({ status: 'stopped', gate: { mode: 'final', version: 2 } }),
      events: [ev(gatePresented(3, 'final'), 1, at(0))],
      gateFiles: [
        { version: 2, md: '- [ ] F13 F13\n' },
        { version: 3, md: responded },
      ],
    })
    expect(decisionConsistency(bundle).gateFilesWithoutAnsweredEvent).toEqual([3])
  })
})

describe('ground-truth join (3.1/3.2)', () => {
  interface GitScript {
    readonly logByRepo: Readonly<Record<string, number>>
    readonly mainPaths: readonly string[]
  }

  function scriptedGit(script: GitScript): { git: AnalyzeGit; calls: string[][] } {
    const calls: string[][] = []
    const git: AnalyzeGit = (cwd, args) => {
      calls.push([...args])
      if (args[0] === 'log') {
        const commits = script.logByRepo[cwd] ?? 0
        return Promise.resolve({
          stdout: Array.from({ length: commits }, (_, i) => `abc${i} commit ${i + 1}`)
            .join('\n')
            .concat('\n'),
          stderr: '',
        })
      }
      const ref = args[1] ?? ''
      const target = args[2] ?? ''
      return Promise.resolve({
        stdout: script.mainPaths.includes(`${ref}:${target}`) ? `040000 tree abc\t${target}\n` : '',
        stderr: '',
      })
    }
    return { git, calls }
  }

  function seedChange(repoRoot: string, name: string, lines: string[]): void {
    const changeDir = path.join(repoRoot, 'openspec', 'changes', name)
    mkdirSync(changeDir, { recursive: true })
    writeFileSync(path.join(changeDir, 'tasks.md'), lines.join('\n').concat('\n'))
  }

  it('a fancy-ui-shaped stranded-complete change: all tasks done, absent from every main ref', async () => {
    const repoRoot = makeDir()
    seedChange(repoRoot, 'fancy-ui', ['- [x] one', '- [x] two'])
    const { git } = scriptedGit({ logByRepo: { [repoRoot]: 2 }, mainPaths: [] })

    const [truth] = await groundTruthJoin(
      nodeAnalyzeFs(),
      git,
      [{ repoRoot, changeName: 'fancy-ui' }],
      ['main', 'master'],
    )

    expect(truth).toMatchObject({
      changeName: 'fancy-ui',
      exists: true,
      tasksDone: 2,
      tasksTotal: 2,
      commits: 2,
      onMainBranch: false,
      strandedComplete: true,
      mergedUnimplemented: false,
    })
  })

  it('a kb-shaped merged-unimplemented change: on the main ref with zero tasks done', async () => {
    const repoRoot = makeDir()
    seedChange(repoRoot, 'kb', ['- [ ] one', '- [ ] two'])
    const { git } = scriptedGit({ logByRepo: { [repoRoot]: 3 }, mainPaths: ['master:openspec/changes/kb'] })

    const [truth] = await groundTruthJoin(nodeAnalyzeFs(), git, [{ repoRoot, changeName: 'kb' }], ['main', 'master'])

    expect(truth).toMatchObject({
      exists: true,
      tasksDone: 0,
      tasksTotal: 2,
      commits: 3,
      onMainBranch: true,
      strandedComplete: false,
      mergedUnimplemented: true,
    })
  })

  it('a change in flight (partial tasks, not on main) is neither stranded nor merged-unimplemented', async () => {
    const repoRoot = makeDir()
    seedChange(repoRoot, 'wip', ['- [x] one', '- [ ] two'])
    const { git } = scriptedGit({ logByRepo: {}, mainPaths: [] })

    const [truth] = await groundTruthJoin(nodeAnalyzeFs(), git, [{ repoRoot, changeName: 'wip' }], ['main'])

    expect(truth?.strandedComplete).toBe(false)
    expect(truth?.mergedUnimplemented).toBe(false)
  })

  it('a missing change folder reports exists false with zero commits, not a failure', async () => {
    const repoRoot = makeDir()
    const { git } = scriptedGit({ logByRepo: {}, mainPaths: [] })

    const [truth] = await groundTruthJoin(nodeAnalyzeFs(), git, [{ repoRoot, changeName: 'vanished' }], ['main'])

    expect(truth).toMatchObject({ exists: false, tasksDone: 0, tasksTotal: 0, commits: 0, onMainBranch: false })
  })

  it('duplicate change folders across workdirs join once', async () => {
    const repoRoot = makeDir()
    seedChange(repoRoot, 'shared', ['- [x] one'])
    const { git } = scriptedGit({ logByRepo: {}, mainPaths: [] })

    const truth = await groundTruthJoin(
      nodeAnalyzeFs(),
      git,
      [
        { repoRoot, changeName: 'shared' },
        { repoRoot, changeName: 'shared' },
      ],
      ['main'],
    )

    expect(truth).toHaveLength(1)
  })
})

describe('corpus report (4.1)', () => {
  const responded = '## Gate response\n\n- [x] F13 F13\n'

  it('renders per-run sections, corpus aggregates, and ground-truth sections as plain text without ANSI', () => {
    const now = new Date(at(60))
    const healthy = bundleOf({
      workDir: '/w-a',
      runId: 'healthy',
      state: stateOf({ runId: 'healthy', changeName: 'fix-command', status: 'completed' }),
      events: [
        ev(roundOpen(1, 3), 1, at(0)),
        ev(spawnedAs('a1', 'drafter'), 2, at(0)),
        ev(doneAs('a1', 0.01), 3, at(2)),
        ev(retryingAs('a1', 'stall', 1), 4, at(1)),
        ev(convergenceOf(1, 'open', { blocker: 0, material: 3, nitpick: 2 }), 5, at(3)),
        ev(roundOpen(2, 3), 6, at(4)),
        ev(convergenceOf(2, 'open', { blocker: 0, material: 2, nitpick: 1 }), 7, at(5)),
        ev(gatePresented(1, 'final'), 8, at(10)),
        ev(gateAnswered(1, 'final'), 9, at(15)),
      ],
      gateFiles: [{ version: 1, md: responded }],
      resolutions: [
        { round: 1, items: [resolutionOf('F1', 'MATERIAL'), resolutionOf('F2', 'NITPICK')] },
        { round: 2, items: [resolutionOf('F1', 'MATERIAL'), resolutionOf('F3', 'NITPICK')] },
      ],
    })
    const contaminated = bundleOf({
      workDir: '/w-a',
      runId: 'trilogy',
      state: stateOf({ runId: 'trilogy', changeName: 'decompose', status: 'completed' }),
      stateBak: true,
      events: [
        ev(gatePresented(1, 'early'), 1, at(0)),
        ev(gateAnswered(1, 'early'), 2, at(1)),
        ev(gateAnswered(2, 'final'), 3, at(2)),
      ],
      gateFiles: [
        { version: 1, md: responded },
        { version: 2, md: responded },
      ],
    })
    const pending = bundleOf({
      workDir: '/w-b',
      runId: 'pending-gate',
      state: stateOf({
        runId: 'pending-gate',
        changeName: 'kb',
        status: 'running',
        gate: { mode: 'final', version: 4 },
      }),
      events: [ev(gatePresented(4, 'final'), 1, at(5))],
      gateFiles: [{ version: 4, md: '- [ ] F1 F1\n' }],
    })
    const truth: readonly ChangeGroundTruth[] = [
      {
        changeName: 'fancy-ui',
        repoRoot: '/repo',
        exists: true,
        tasksDone: 2,
        tasksTotal: 2,
        commits: 2,
        onMainBranch: false,
        strandedComplete: true,
        mergedUnimplemented: false,
      },
      {
        changeName: 'kb',
        repoRoot: '/repo',
        exists: true,
        tasksDone: 0,
        tasksTotal: 2,
        commits: 3,
        onMainBranch: true,
        strandedComplete: false,
        mergedUnimplemented: true,
      },
    ]

    const report = buildCorpusReport([healthy, contaminated, pending], truth, { now })
    const text = renderCorpusReport(report)

    expect(text).toContain('## run healthy (/w-a)')
    expect(text).toContain('## run trilogy (/w-a)')
    expect(text).toContain('## run pending-gate (/w-b)')
    expect(text).toContain('## corpus')
    expect(text).toContain('## stranded-complete')
    expect(text).toContain('fancy-ui')
    expect(text).toContain('## merged-unimplemented')
    expect(text).toContain('kb')
    expect(text).not.toContain(String.fromCharCode(27))
  })

  it('aggregates exclude era-contaminated runs and pool the corpus-level counts', () => {
    const now = new Date(at(60))
    const healthy = bundleOf({
      workDir: '/w-a',
      runId: 'healthy',
      state: stateOf({ runId: 'healthy', changeName: 'fix-command', status: 'completed' }),
      events: [
        ev(roundOpen(1, 2), 1, at(0)),
        ev(convergenceOf(1, 'open', { blocker: 0, material: 3, nitpick: 1 }), 2, at(1)),
        ev(roundOpen(2, 2), 3, at(2)),
        ev(convergenceOf(2, 'open', { blocker: 0, material: 2, nitpick: 0 }), 4, at(3)),
        ev(gatePresented(1, 'early'), 5, at(5)),
        ev(autoDecision('R4', 'gate', 1), 6, at(6)),
        ev(gateAnswered(1, 'early'), 7, at(7)),
        ev(gatePresented(2, 'final'), 8, at(10)),
      ],
      resolutions: [
        { round: 1, items: [resolutionOf('F1', 'MATERIAL'), resolutionOf('F2', 'NITPICK')] },
        {
          round: 2,
          items: [resolutionOf('F1', 'MATERIAL'), resolutionOf('F3', 'NITPICK'), resolutionOf('F3', 'NITPICK')],
        },
      ],
    })
    const contaminated = bundleOf({
      workDir: '/w-a',
      runId: 'trilogy',
      state: stateOf({ runId: 'trilogy', changeName: 'decompose', status: 'completed' }),
      events: [
        ev(gatePresented(1, 'early'), 1, at(0)),
        ev(gateAnswered(1, 'early'), 2, at(1)),
        ev(gateAnswered(2, 'final'), 3, at(2)),
      ],
      gateFiles: [
        { version: 1, md: responded },
        { version: 2, md: responded },
      ],
      resolutions: [{ round: 1, items: [resolutionOf('F9', 'MATERIAL'), resolutionOf('F9', 'MATERIAL')] }],
    })

    const report = buildCorpusReport([healthy, contaminated], [], { now })

    expect(report.aggregates.runsAggregated).toBe(1)
    expect(report.aggregates.eraContaminated).toEqual(['trilogy'])
    expect(report.aggregates.autoDecisionsByRule).toEqual({ R4: 1 })
    expect(report.aggregates.duplicateResolutionEntries).toBe(1)
    expect(report.aggregates.r2Eligibility).toEqual({
      eligible: 1,
      gateStates: 1,
      byCause: { 'over-ceiling': 1 },
    })
    expect(report.aggregates.gatesNeverAnswered).toBe(1)
  })

  it('--json emits the same structure machine-readably', () => {
    const now = new Date(at(60))
    const healthy = bundleOf({
      workDir: '/w-a',
      runId: 'healthy',
      state: stateOf({ runId: 'healthy', changeName: 'fix-command', status: 'completed' }),
      events: [ev(gatePresented(1, 'final'), 1, at(0)), ev(gateAnswered(1, 'final'), 2, at(1))],
      gateFiles: [{ version: 1, md: responded }],
    })
    const truth: readonly ChangeGroundTruth[] = [
      {
        changeName: 'kb',
        repoRoot: '/repo',
        exists: true,
        tasksDone: 0,
        tasksTotal: 2,
        commits: 3,
        onMainBranch: true,
        strandedComplete: false,
        mergedUnimplemented: true,
      },
    ]
    const report = buildCorpusReport([healthy], truth, { now })

    const parsed = recordOf(JSON.parse(renderCorpusJson(report)))
    const runs = arrayField(parsed, 'runs')
    const truthEntries = arrayField(parsed, 'groundTruth')
    const merged = arrayField(recordOf(parsed['aggregates']), 'mergedUnimplemented')
    expect(runs).toHaveLength(1)
    expect(truthEntries.map((entry) => recordOf(entry)['changeName'])).toEqual(['kb'])
    expect(merged).toContain('kb')
  })

  it('usage per role reprices through the reprice seam with costKnown fail-closed', () => {
    const priced = bundleOf({
      events: [ev(spawnedAs('a1', 'drafter'), 1, at(0)), ev(doneAs('a1', 0.02), 2, at(1))],
    })
    const unpriced = bundleOf({
      events: [ev(spawnedAs('a1', 'drafter'), 1, at(0)), ev(doneAs('a1', 0), 3, at(1))],
    })
    const pricedRun = analyzeRun(priced, new Date(at(10)), () => null)
    const unpricedRun = analyzeRun(unpriced, new Date(at(10)), () => null)
    expect(pricedRun.usage.costKnown).toBe(true)
    expect(pricedRun.usage.byRole['drafter']?.costUsd).toBeCloseTo(0.02)
    expect(unpricedRun.usage.costKnown).toBe(false)
  })
})
