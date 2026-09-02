// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { FindingSchema } from '../../afk-runner/src/agent-schemas.js'
import { buildCorpusReport } from '../../afk-runner/src/analyze-corpus.js'
import {
  classChurn,
  concernPersistence,
  duplicateIdRate,
  lensOverlapRate,
  resolverActionMix,
  r2EligibilityRate,
} from '../../afk-runner/src/analyze-findings.js'
import { gateForensics, decisionConsistency } from '../../afk-runner/src/analyze-gates.js'
import {
  changeDirOf,
  discoverRunIds,
  loadCorpus,
  loadRunBundle,
  nodeAnalyzeFs,
  readOnlyGit,
  readChangeFolder,
} from '../../afk-runner/src/analyze-io.js'
import type { AnalyzeFs, AnalyzeGit, RunBundle } from '../../afk-runner/src/analyze-io.js'
import { renderCorpusJson, renderCorpusReport } from '../../afk-runner/src/analyze-report.js'
import { groundTruthJoin, MAIN_REF_CANDIDATES } from '../../afk-runner/src/analyze-truth.js'
import { usageOf } from '../../afk-runner/src/analyze-usage.js'
import {
  knownMetric,
  retryTaxonomy,
  stageFailureTaxonomy,
  trajectoryMetric,
  unknownMetric,
} from '../../afk-runner/src/analyze.js'
import type { Metric } from '../../afk-runner/src/analyze.js'
import { flattenPosition } from '../../afk-runner/src/drive/loop.js'
import type { AgentUsage } from '../../afk-runner/src/events.js'
import { stampEvent } from '../../afk-runner/src/events.js'
import { pipelineMachine } from '../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../afk-runner/src/kernel/fold.js'
import { memoFieldsOf } from '../../afk-runner/src/memo-project.js'
import { EMPTY_USAGE, plusUsage } from '../../afk-runner/src/work/gate-signals.js'

/**
 * Read-only analysis seams (D2): the fs type exposes only read functions —
 * the no-write contract is the seam's shape, not discipline — and the git
 * wrapper admits only `log`/`ls-tree`.
 */

/** Type-level pin: no write member may ever appear on the fs seam type. */
type WriteMemberAbsent = 'writeFile' extends keyof AnalyzeFs
  ? 'write members must be absent from AnalyzeFs'
  : 'read-only'
const WRITE_MEMBER_ABSENT: WriteMemberAbsent = 'read-only'

/** Type-level pin: the seam's full surface is exactly the three read functions. */
type SeamMembers = keyof AnalyzeFs
const SEAM_MEMBERS: readonly SeamMembers[] = ['readFile', 'readdir', 'stat']

const tmpDirs: string[] = []

function makeDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('analyze-io — the read-only fs seam', () => {
  it('exposes exactly readFile/readdir/stat (type-level pin: write members absent)', () => {
    expect(WRITE_MEMBER_ABSENT).toBe('read-only')
    expect([...SEAM_MEMBERS].sort()).toEqual(['readFile', 'readdir', 'stat'])
    const seam: AnalyzeFs = nodeAnalyzeFs()
    expect(Object.keys(seam).sort()).toEqual(['readFile', 'readdir', 'stat'])
    for (const writeMember of ['writeFile', 'appendFile', 'rename', 'rm']) {
      expect(writeMember in seam).toBe(false)
    }
  })

  it('reads files and directory listings through node fs', async () => {
    const dir = makeDir('afk-analyze-io-')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'content')
    const seam = nodeAnalyzeFs()
    expect(await seam.readFile(path.join(dir, 'a.txt'))).toBe('content')
    expect(await seam.readdir(dir)).toEqual(['a.txt'])
    const stat = await seam.stat(path.join(dir, 'a.txt'))
    expect(stat.isFile()).toBe(true)
    expect(stat.isDirectory()).toBe(false)
  })
})

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The unknown branch's reason, or null on a known metric (test-side narrowing helper). */
function unknownReasonOf(metric: Metric<unknown>): string | null {
  return metric.status === 'unknown' ? metric.reason : null
}

/** The park a fold implies (memo-parity's rule): done snapshots are final, everything else awaits an answer. */
function haltedOf(status: string): 'final' | 'gate-pending' {
  return status === 'done' ? 'final' : 'gate-pending'
}

describe('analyze-io — the read-only git wrapper', () => {
  it('admits log and ls-tree subcommands', async () => {
    const calls: (readonly string[])[] = []
    const exec: AnalyzeGit = (_cwd, args) => {
      calls.push(args)
      return Promise.resolve({ stdout: 'out', stderr: '' })
    }
    const git = readOnlyGit(exec)
    expect(await git('/repo', ['log', '--oneline'])).toEqual({ stdout: 'out', stderr: '' })
    expect(await git('/repo', ['ls-tree', 'main', 'openspec/changes'])).toEqual({ stdout: 'out', stderr: '' })
    expect(calls).toHaveLength(2)
  })

  it('rejects any other subcommand by name, never calling the wrapped exec', async () => {
    let called = false
    const exec: AnalyzeGit = () => {
      called = true
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    const git = readOnlyGit(exec)
    for (const args of [['status', '--porcelain'], ['add', '.'], ['commit', '-m', 'x'], ['push'], []] as const) {
      const failure = await git('/repo', args).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(Error)
      expect(messageOf(failure)).toMatch(/read-only git seam rejected/u)
      expect(called).toBe(false)
    }
    const noArgs = await git('/repo', []).catch((error: unknown) => error)
    expect(messageOf(noArgs)).toContain('<none>')
  })
})

/**
 * Shared corpus fixture: synthetic minimal run dirs under a workdir — events
 * as raw ndjson lines so torn/garbage lines are writable, sidecars and gate
 * files as plain files. Shaped from the committed corpus, never copies.
 */
const T0 = '2026-09-01T00:00:00.000Z'

function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString()
}

function stageEnterLine(stage: string, seq: number, ts: string): string {
  return JSON.stringify({ altitude: 'L2', type: 'stage_enter', stage, seq, ts })
}

function roundOpenLine(round: number, cap: number, seq: number, ts: string): string {
  return JSON.stringify({ altitude: 'L2', type: 'round_open', round, cap, seq, ts })
}

function convergenceLine(
  round: number,
  verdict: string,
  counts: { blocker: number; material: number; nitpick: number },
  seq: number,
  ts: string,
  open?: { blocker: number; material: number; nitpick: number },
): string {
  return JSON.stringify({
    altitude: 'L2',
    type: 'convergence',
    round,
    verdict,
    counts,
    ...(open === undefined ? {} : { open }),
    seq,
    ts,
  })
}

function gateLine(
  action: 'presented' | 'answered' | 'rearmed',
  mode: string,
  version: number,
  seq: number,
  ts: string,
  outcome?: string,
): string {
  return JSON.stringify({
    altitude: 'L2',
    type: 'gate',
    action,
    mode,
    version,
    ...(outcome === undefined ? {} : { outcome }),
    seq,
    ts,
  })
}

function autoDecisionLine(rule: string, decision: string, gateVersion: number, seq: number, ts: string): string {
  return JSON.stringify({
    altitude: 'L2',
    type: 'auto_decision',
    rule,
    decision,
    evidenceDigest: `digest-${seq}`,
    gateVersion,
    seq,
    ts,
  })
}

function doneLine(agent: string, usage: Record<string, number>, seq: number, ts: string): string {
  return JSON.stringify({
    altitude: 'L1',
    type: 'done',
    agent,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0,
      wallMs: 0,
      ...usage,
    },
    seq,
    ts,
  })
}

interface RunFixture {
  readonly events?: readonly string[]
  readonly state?: Record<string, unknown> | null
  readonly stateBak?: boolean
  readonly sidecars?: Record<string, string>
  readonly gateFiles?: Record<string, string>
}

function writeRun(workDir: string, runId: string, fixture: RunFixture = {}): string {
  const runDir = path.join(workDir, 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  if (fixture.events !== undefined) {
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), `${fixture.events.join('\n')}\n`)
  }
  if (fixture.state !== null) {
    const base: Record<string, unknown> = {
      runId,
      repoRoot: '/repo',
      workDir,
      changeName: runId,
      stage: 'review',
      depth: 'S',
      round: 1,
      gate: null,
      status: 'completed',
      createdAt: T0,
      updatedAt: T0,
    }
    fs.writeFileSync(path.join(runDir, 'state.json'), `${JSON.stringify({ ...base, ...fixture.state }, null, 2)}\n`)
  }
  if (fixture.stateBak === true) {
    fs.writeFileSync(path.join(runDir, 'state.json.bak'), '{}\n')
  }
  for (const [name, body] of Object.entries(fixture.sidecars ?? {})) {
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    fs.writeFileSync(path.join(runDir, 'sidecars', name), body)
  }
  for (const [name, body] of Object.entries(fixture.gateFiles ?? {})) {
    fs.writeFileSync(path.join(runDir, name), body)
  }
  return runDir
}

describe('analyze-io — run discovery and tolerant loading', () => {
  it('discovers run ids across one or more workdirs, sorted; an absent runs/ dir is no runs', async () => {
    const first = makeDir('afk-corpus-a-')
    const second = makeDir('afk-corpus-b-')
    writeRun(first, 'b-run')
    writeRun(first, 'a-run')
    const seam = nodeAnalyzeFs()
    expect(await discoverRunIds(seam, first)).toEqual(['a-run', 'b-run'])
    expect(await discoverRunIds(seam, second)).toEqual([])
    expect(await loadCorpus(seam, [first, second])).toHaveLength(2)
  })

  it('drops unparsable event lines and counts them, never failing', async () => {
    const workDir = makeDir('afk-torn-')
    writeRun(workDir, 'torn', {
      events: [stageEnterLine('intake', 1, T0), '{"garbage":', stageEnterLine('draft', 3, at(1_000))],
    })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'torn')
    expect(bundle.events).toHaveLength(2)
    expect(bundle.events[0]).toMatchObject({ type: 'stage_enter', stage: 'intake' })
    expect(bundle.droppedEventLines).toBe(1)
  })

  it('loads missing/corrupt memo, sidecars, and gate files as absent', async () => {
    const workDir = makeDir('afk-absent-')
    writeRun(workDir, 'sparse', {
      state: null,
      sidecars: {
        'findings-1.json': '{not json',
        'resolutions-1.json': JSON.stringify({ resolutions: [] }),
      },
    })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'sparse')
    expect(bundle.state).toBeNull()
    expect(bundle.findings).toEqual([])
    expect(bundle.resolutions).toEqual([{ round: 1, items: [] }])
    expect(bundle.gateFiles).toEqual([])
    expect(bundle.sidecarFailures).toBe(1)
  })

  it('loads sidecars and gate files per round/version with afk naming', async () => {
    const workDir = makeDir('afk-sidecars-')
    const finding = FindingSchema.parse({
      id: 'F1',
      class: 'MATERIAL',
      gap: 'the proposal lacks a rollback story',
      question: 'how do we roll back?',
      code_evidence_attempted: 'searched the repo, none found',
    })
    writeRun(workDir, 'rich', {
      events: [stageEnterLine('intake', 1, T0)],
      sidecars: {
        'findings-1.json': JSON.stringify({ findings: [finding] }),
        'findings-skeptic-2.json': JSON.stringify({ findings: [finding] }),
        'resolutions-2.json': JSON.stringify({
          resolutions: [
            { id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'out of scope' },
            { id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'dup id in round' },
          ],
        }),
      },
      gateFiles: { 'gate-1.md': '## Gate\n', 'gate-2.md': 'APPROVE\n' },
    })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'rich')
    expect(bundle.findings).toEqual([{ round: 1, items: [finding] }])
    expect(bundle.skepticFindings).toEqual([{ round: 2, items: [finding] }])
    expect(bundle.resolutions[0]?.round).toBe(2)
    expect(bundle.resolutions[0]?.items).toHaveLength(2)
    expect(bundle.gateFiles.map((gate) => gate.version)).toEqual([1, 2])
    expect(bundle.gateFiles[1]?.md).toBe('APPROVE\n')
  })

  it('a run whose events predate a vocabulary loads with explicit unknown coverage inputs', async () => {
    const workDir = makeDir('afk-prevocab-')
    writeRun(workDir, 'legacy', {
      events: [
        stageEnterLine('intake', 1, T0),
        convergenceLine(1, 'open', { blocker: 1, material: 0, nitpick: 0 }, 2, at(1_000)),
      ],
      state: { status: 'aborted' },
    })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'legacy')
    expect(bundle.state?.status).toBe('aborted')
    // Pre-vocabulary: no gate events, no sidecars — the metrics that need
    // them must be able to say unknown over this bundle.
    expect(bundle.gateFiles).toEqual([])
    expect(bundle.resolutions).toEqual([])
  })
})

describe('analyze-io — change-folder resolution', () => {
  it('counts tasks.md checkboxes and reports the folder path', async () => {
    const repoRoot = makeDir('afk-repo-')
    const changeName = 'add-thing'
    fs.mkdirSync(path.join(repoRoot, 'openspec', 'changes', changeName), { recursive: true })
    fs.writeFileSync(
      path.join(repoRoot, 'openspec', 'changes', changeName, 'tasks.md'),
      '# Tasks\n\n- [x] 1.1 done\n- [ ] 1.2 pending\n- [x] 1.3 done\n',
    )
    const seam = nodeAnalyzeFs()
    const folder = await readChangeFolder(seam, repoRoot, changeName)
    expect(folder).toEqual({
      changeDir: changeDirOf(repoRoot, changeName),
      exists: true,
      tasksDone: 2,
      tasksTotal: 3,
    })
  })

  it('a missing folder reports exists:false with zero tasks, never an error', async () => {
    const repoRoot = makeDir('afk-empty-repo-')
    const seam = nodeAnalyzeFs()
    const folder = await readChangeFolder(seam, repoRoot, 'never-heard-of')
    expect(folder.exists).toBe(false)
    expect(folder.tasksDone).toBe(0)
    expect(folder.tasksTotal).toBe(0)
  })

  it('an existing folder without tasks.md exists but counts zero', async () => {
    const repoRoot = makeDir('afk-notasks-')
    fs.mkdirSync(path.join(repoRoot, 'openspec', 'changes', 'bare'), { recursive: true })
    const folder = await readChangeFolder(nodeAnalyzeFs(), repoRoot, 'bare')
    expect(folder.exists).toBe(true)
    expect(folder.tasksTotal).toBe(0)
  })
})

describe('analyze — Metric shape and the kernel-fold trajectory', () => {
  it('Metric is known-with-value or unknown-with-reason', () => {
    expect(knownMetric(7)).toEqual({ status: 'known', value: 7 })
    expect(unknownMetric('no convergence records')).toEqual({ status: 'unknown', reason: 'no convergence records' })
    const metric: Metric<number> = unknownMetric('why')
    expect(metric.status).toBe('unknown')
  })

  it('trajectory reads the folded perRound digest (open set falling back to raised counts)', async () => {
    const workDir = makeDir('afk-traj-')
    writeRun(workDir, 'traj', {
      events: [
        roundOpenLine(1, 2, 1, T0),
        convergenceLine(1, 'open', { blocker: 1, material: 2, nitpick: 0 }, 2, at(1_000), {
          blocker: 0,
          material: 1,
          nitpick: 0,
        }),
        roundOpenLine(2, 2, 3, at(2_000)),
        convergenceLine(2, 'converged', { blocker: 0, material: 0, nitpick: 0 }, 4, at(3_000)),
      ],
    })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'traj')
    expect(trajectoryMetric(bundle)).toEqual({
      status: 'known',
      value: [
        {
          round: 1,
          counts: { blocker: 1, material: 2, nitpick: 0 },
          open: { blocker: 0, material: 1, nitpick: 0 },
          concerns: [],
          resolved: 0,
          dismissed: 0,
          verdict: 'open',
        },
        {
          round: 2,
          counts: { blocker: 0, material: 0, nitpick: 0 },
          open: { blocker: 0, material: 0, nitpick: 0 },
          concerns: [],
          resolved: 0,
          dismissed: 0,
          verdict: 'converged',
        },
      ],
    })
  })

  it('a run with no convergence records reports the trajectory unknown with its reason', async () => {
    const workDir = makeDir('afk-notraj-')
    writeRun(workDir, 'bare', { events: [stageEnterLine('intake', 1, T0)] })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'bare')
    expect(trajectoryMetric(bundle)).toEqual({ status: 'unknown', reason: 'no convergence records' })
  })
})

describe('analyze — retry and stage-failure taxonomy', () => {
  it('retry taxonomy joins spawned agents to roles and splits stall vs validation', async () => {
    const workDir = makeDir('afk-retry-')
    const retryLine = (agent: string, reason: string, attempt: number, seq: number, ts: string): string =>
      JSON.stringify({ altitude: 'L1', type: 'retrying', agent, reason, attempt, seq, ts })
    const spawnedLine = (agent: string, role: string, seq: number, ts: string): string =>
      JSON.stringify({ altitude: 'L1', type: 'spawned', agent, role, model: 'm', seq, ts })
    writeRun(workDir, 'retried', {
      events: [
        spawnedLine('agent-1', 'reviewer', 1, T0),
        spawnedLine('agent-2', 'resolver', 2, at(1)),
        retryLine('agent-1', 'stall', 2, 3, at(2)),
        retryLine('agent-1', 'validation', 3, 4, at(3)),
        retryLine('agent-2', 'stall', 2, 5, at(4)),
        retryLine('unknown-agent', 'stall', 2, 6, at(5)),
      ],
    })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'retried')
    expect(retryTaxonomy(bundle)).toEqual({
      status: 'known',
      value: {
        reviewer: { stall: 1, validation: 1 },
        resolver: { stall: 1, validation: 0 },
        'unknown-agent': { stall: 1, validation: 0 },
      },
    })
  })

  it('a run with no log reports retries unknown; no retries is a known empty mix', async () => {
    const workDir = makeDir('afk-noretry-')
    writeRun(workDir, 'empty-log', {})
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'empty-log')
    expect(retryTaxonomy(bundle)).toEqual({ status: 'unknown', reason: 'no event log' })
    const withLog = makeDir('afk-noretry2-')
    writeRun(withLog, 'quiet', { events: [stageEnterLine('intake', 1, T0)] })
    const quiet = await loadRunBundle(nodeAnalyzeFs(), withLog, 'quiet')
    expect(retryTaxonomy(quiet)).toEqual({ status: 'known', value: {} })
  })

  it('stage-failure taxonomy counts declared failures by stage and kind', async () => {
    const workDir = makeDir('afk-failures-')
    const failureLine = (stage: string, kind: string, seq: number, ts: string): string =>
      JSON.stringify({ altitude: 'L2', type: 'stage_failed', stage, kind, reason: 'r', seq, ts })
    writeRun(workDir, 'failed', {
      events: [
        stageEnterLine('review', 1, T0),
        failureLine('review', 'exhausted', 2, at(1_000)),
        failureLine('review', 'exhausted', 3, at(2_000)),
        failureLine('draft', 'precondition', 4, at(3_000)),
        failureLine('review', 'infra', 5, at(4_000)),
      ],
    })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'failed')
    expect(stageFailureTaxonomy(bundle)).toEqual({
      status: 'known',
      value: {
        review: { exhausted: 2, precondition: 0, infra: 1 },
        draft: { exhausted: 0, precondition: 1, infra: 0 },
      },
    })
  })

  it('a run with no failures reports a known empty taxonomy', async () => {
    const workDir = makeDir('afk-nofail-')
    writeRun(workDir, 'clean', { events: [stageEnterLine('intake', 1, T0)] })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'clean')
    expect(stageFailureTaxonomy(bundle)).toEqual({ status: 'known', value: {} })
  })
})

const NOW = new Date('2026-09-01T01:00:00.000Z')

/** A gate-drama bundle: policy settle, waiter settle, human settle, and a never-answered gate. */
async function gateDramaBundle(): Promise<RunBundle> {
  const workDir = makeDir('afk-gates-')
  writeRun(workDir, 'drama', {
    events: [
      // v1: policy (prelude) — auto_decision BEFORE the answered event
      gateLine('presented', 'early', 1, 1, T0),
      autoDecisionLine('R1', 'approve', 1, 2, at(60_000)),
      gateLine('answered', 'early', 1, 3, at(60_000), 'approve'),
      // v2: waiter — auto_decision AFTER the answered event
      gateLine('presented', 'early', 2, 4, at(120_000)),
      gateLine('answered', 'early', 2, 5, at(600_000), 'extend'),
      autoDecisionLine('R2', 'extend', 2, 6, at(600_000)),
      // v3: human — answered with no settle-kind record
      gateLine('presented', 'final', 3, 7, at(700_000)),
      autoDecisionLine('none', 'gate', 3, 8, at(700_000)),
      gateLine('answered', 'final', 3, 9, at(800_000), 'veto'),
      // v4: presented, never answered; the waiter fingerprinted it (pending + rearm)
      gateLine('presented', 'escalation', 4, 10, at(900_000)),
      gateLine('rearmed', 'escalation', 4, 11, at(1_200_000)),
      autoDecisionLine('none', 'pending', 4, 12, at(1_200_000)),
    ],
  })
  const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'drama')
  return bundle
}

describe('analyze-gates — gate forensics with settle-origin by emission order', () => {
  it('attributes settledBy by emission order: policy before the answer, waiter after, human silent', async () => {
    const forensics = gateForensics(await gateDramaBundle(), NOW)
    expect(forensics).toMatchObject({
      status: 'known',
      value: {
        answered: [
          { version: 1, mode: 'early', latencyMs: 60_000, settledBy: 'policy', rule: 'R1' },
          { version: 2, mode: 'early', latencyMs: 480_000, settledBy: 'waiter', rule: 'R2' },
          { version: 3, mode: 'final', latencyMs: 100_000, settledBy: 'human', rule: null },
        ],
      },
    })
  })

  it('never-answered gates carry their age into the report, never dropped', async () => {
    const forensics = gateForensics(await gateDramaBundle(), NOW)
    expect(forensics).toMatchObject({
      status: 'known',
      value: { neverAnswered: [{ version: 4, mode: 'escalation', ageMs: 2_700_000 }] },
    })
  })

  it('counts auto decisions by rule and the unconditional waiter fingerprints', async () => {
    const forensics = gateForensics(await gateDramaBundle(), NOW)
    expect(forensics).toMatchObject({
      status: 'known',
      value: {
        autoDecisionsByRule: { R1: 1, R2: 1, none: 2 },
        waiterPendingRecords: 1,
        waiterRearms: 1,
      },
    })
  })

  it('attributes extends by origin: policy, waiter, and human gate-file extends', async () => {
    const workDir = makeDir('afk-extends-')
    writeRun(workDir, 'extends', {
      events: [
        // policy extend: record before the answered event
        gateLine('presented', 'early', 1, 1, T0),
        autoDecisionLine('R2', 'extend', 1, 2, at(1_000)),
        gateLine('answered', 'early', 1, 3, at(2_000), 'extend'),
        // waiter extend: record after the answered event
        gateLine('presented', 'early', 2, 4, at(3_000)),
        gateLine('answered', 'early', 2, 5, at(4_000), 'extend'),
        autoDecisionLine('R2', 'extend', 2, 6, at(5_000)),
      ],
      gateFiles: {
        // human extend: gate file directive with no extend auto_decision
        'gate-3.md': '→ RUN 1 MORE\n',
      },
    })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'extends')
    const forensics = gateForensics(bundle, NOW)
    expect(forensics).toMatchObject({
      status: 'known',
      value: {
        extends: [
          { version: 1, origin: 'policy', rule: 'R2' },
          { version: 2, origin: 'waiter', rule: 'R2' },
          { version: 3, origin: 'human', rule: null },
        ],
      },
    })
  })

  it('a run with no gate events or gate files reports the metric unknown', async () => {
    const workDir = makeDir('afk-nogates-')
    writeRun(workDir, 'gateless', { events: [stageEnterLine('intake', 1, T0)] })
    const forensics = gateForensics(await loadRunBundle(nodeAnalyzeFs(), workDir, 'gateless'), NOW)
    expect(forensics).toEqual({ status: 'unknown', reason: 'no gate events or gate files' })
  })
})

function findingOf(id: string, klass: string, gap: string): Record<string, string> {
  return { id, class: klass, gap, question: `q-${id}`, code_evidence_attempted: 'searched' }
}

function resolutionOf(id: string, klass: string, resolution: string): Record<string, string> {
  return resolution === 'dismissed'
    ? { id, class: klass, resolution, justification: 'out of scope' }
    : { id, class: klass, resolution, outcome: 'done' }
}

/** The lifecycle fixture: dup ledger ids, lens overlap, class churn, mixed resolver actions. */
async function lifecycleBundle(): Promise<RunBundle> {
  const workDir = makeDir('afk-lifecycle-')
  writeRun(workDir, 'life', {
    events: [stageEnterLine('intake', 1, T0)],
    sidecars: {
      'findings-1.json': JSON.stringify({
        findings: [findingOf('F1', 'MATERIAL', 'rollback story missing'), findingOf('F2', 'BLOCKER', 'no tests')],
      }),
      'findings-2.json': JSON.stringify({
        findings: [findingOf('F1', 'NITPICK', 'rollback story missing'), findingOf('F3', 'MATERIAL', 'typo')],
      }),
      'findings-skeptic-2.json': JSON.stringify({
        findings: [
          findingOf('S1', 'MATERIAL', 'Rollback Story Missing'),
          findingOf('S2', 'MATERIAL', 'auth never expires'),
        ],
      }),
      'resolutions-1.json': JSON.stringify({
        resolutions: [
          resolutionOf('F1', 'MATERIAL', 'edited'),
          resolutionOf('F1', 'MATERIAL', 'edited'),
          resolutionOf('F2', 'BLOCKER', 'evidence-answered'),
        ],
      }),
      'resolutions-2.json': JSON.stringify({
        resolutions: [resolutionOf('F1', 'NITPICK', 'dismissed')],
      }),
    },
  })
  const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'life')
  return bundle
}

describe('analyze-findings — finding lifecycle over sidecar joins', () => {
  it('duplicateIdRate counts within-round ledger dups over all resolution entries', async () => {
    const bundle = await lifecycleBundle()
    expect(duplicateIdRate(bundle)).toEqual({ status: 'known', value: 0.25 })
  })

  it('lensOverlapRate matches skeptic findings against the reviewer lens by gap fingerprint (loop-memory D1 handoff)', async () => {
    const bundle = await lifecycleBundle()
    expect(lensOverlapRate(bundle)).toEqual({ status: 'known', value: 0.5 })
  })

  it('classChurn is the churned share of finding ids spanning multiple rounds', async () => {
    const bundle = await lifecycleBundle()
    expect(classChurn(bundle)).toEqual({ status: 'known', value: 1 })
  })

  it('resolverActionMix counts resolution actions across the ledger', async () => {
    const bundle = await lifecycleBundle()
    expect(resolverActionMix(bundle)).toEqual({
      status: 'known',
      value: { edited: 2, 'evidence-answered': 1, dismissed: 1 },
    })
  })

  it('concernPersistence measures cross-round re-raises by gap fingerprint (loop-memory D1 handoff)', async () => {
    const bundle = await lifecycleBundle()
    // Clusters: 'rollback story missing' spans r1..r2; 'no tests', 'typo',
    // 'auth never expires' are single-round — one of four persists.
    expect(concernPersistence(bundle)).toEqual({ status: 'known', value: 0.25 })
  })

  it('every lifecycle metric is unknown with its reason over a run without sidecars', async () => {
    const workDir = makeDir('afk-bare-')
    writeRun(workDir, 'bare', { events: [stageEnterLine('intake', 1, T0)] })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'bare')
    expect(duplicateIdRate(bundle)).toEqual({ status: 'unknown', reason: 'no resolutions sidecars' })
    expect(lensOverlapRate(bundle)).toEqual({ status: 'unknown', reason: 'no skeptic findings sidecars' })
    expect(classChurn(bundle)).toEqual({ status: 'unknown', reason: 'no finding id spans multiple rounds' })
    expect(resolverActionMix(bundle)).toEqual({ status: 'unknown', reason: 'no resolutions sidecars' })
    expect(concernPersistence(bundle)).toEqual({ status: 'unknown', reason: 'no findings sidecars' })
  })
})

/**
 * The cap-hit drama for r2 attribution: round 2 of cap 2 records verdict
 * open with an eligible open set and a falling raised trajectory, and the
 * first early presentation after the convergence carries the state's
 * auto_decision records.
 */
async function capHitBundle(options: {
  readonly records: readonly string[]
  readonly metered?: boolean
  readonly withState?: boolean
  readonly open?: { blocker: number; material: number; nitpick: number }
  readonly raisedCurrent?: { blocker: number; material: number; nitpick: number }
  readonly verdict?: string
}): Promise<RunBundle> {
  const workDir = makeDir('afk-r2-')
  writeRun(workDir, 'cap-hit', {
    state: options.withState === false ? null : { metered: options.metered },
    events: [
      roundOpenLine(1, 2, 1, T0),
      convergenceLine(1, 'open', { blocker: 0, material: 3, nitpick: 0 }, 2, at(1_000)),
      roundOpenLine(2, 2, 3, at(2_000)),
      convergenceLine(
        2,
        options.verdict ?? 'open',
        options.raisedCurrent ?? { blocker: 0, material: 1, nitpick: 0 },
        4,
        at(3_000),
        options.open,
      ),
      gateLine('presented', 'early', 1, 5, at(4_000)),
      ...options.records.map((decision, index) => {
        const parts = decision.split(':')
        return autoDecisionLine(parts[0] ?? '', parts[1] ?? '', 1, 6 + index, at(5_000))
      }),
    ],
  })
  const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'cap-hit')
  return bundle
}

describe('analyze-findings — r2 eligibility with blocking-cause attribution (D5/D6)', () => {
  it('a metered cost-unknown run attributes its eligible state cost-unknown', async () => {
    const bundle = await capHitBundle({ records: ['R4:gate'], metered: true })
    const metric = r2EligibilityRate(bundle, false)
    expect(metric).toEqual({
      status: 'known',
      value: { eligible: 1, gateStates: 1, byCause: { 'cost-unknown': 1 } },
    })
  })

  it('an unmetered run attributes over-ceiling — the cost-unknown branch cannot fire', async () => {
    const bundle = await capHitBundle({ records: ['R4:gate'], metered: false })
    expect(r2EligibilityRate(bundle, false)).toEqual({
      status: 'known',
      value: { eligible: 1, gateStates: 1, byCause: { 'over-ceiling': 1 } },
    })
  })

  it('a metered cost-known run attributes over-ceiling', async () => {
    const bundle = await capHitBundle({ records: ['R4:gate'], metered: true })
    expect(r2EligibilityRate(bundle, true)).toEqual({
      status: 'known',
      value: { eligible: 1, gateStates: 1, byCause: { 'over-ceiling': 1 } },
    })
  })

  it('an extend auto-decision naming R2 attributes r2-fired', async () => {
    const bundle = await capHitBundle({ records: ['R2:extend'], metered: true })
    expect(r2EligibilityRate(bundle, true)).toEqual({
      status: 'known',
      value: { eligible: 1, gateStates: 1, byCause: { 'r2-fired': 1 } },
    })
  })

  it('a legacy preview record attributes preview', async () => {
    const bundle = await capHitBundle({ records: ['none:preview'], metered: true })
    expect(r2EligibilityRate(bundle, true)).toEqual({
      status: 'known',
      value: { eligible: 1, gateStates: 1, byCause: { preview: 1 } },
    })
  })

  it('a failing trajectory predicate attributes trajectory-blocked (flat raised, open blockers alike)', async () => {
    const flat = await capHitBundle({
      records: ['R2:extend'],
      metered: true,
      raisedCurrent: { blocker: 0, material: 3, nitpick: 0 },
    })
    expect(r2EligibilityRate(flat, true)).toEqual({
      status: 'known',
      value: { eligible: 0, gateStates: 1, byCause: { 'trajectory-blocked': 1 } },
    })
    const blocked = await capHitBundle({
      records: ['R2:extend'],
      metered: true,
      open: { blocker: 1, material: 1, nitpick: 0 },
    })
    expect(r2EligibilityRate(blocked, true)).toEqual({
      status: 'known',
      value: { eligible: 0, gateStates: 1, byCause: { 'trajectory-blocked': 1 } },
    })
  })

  it('eligibility reads the open set with the raised fallback; needs-review never enumerates a state', async () => {
    // open set material present but raised blockers too — pre-split record
    // falls back to raised for eligibility; still eligible (0 raised blockers).
    const preSplit = await capHitBundle({ records: ['R2:extend'], metered: true, open: undefined })
    const preSplitMetric = r2EligibilityRate(preSplit, true)
    expect(preSplitMetric.status).toBe('known')

    const review = await capHitBundle({ records: ['R2:extend'], metered: true, verdict: 'needs-review' })
    expect(r2EligibilityRate(review, true)).toEqual({
      status: 'unknown',
      reason: 'no cap-hit convergence pairs',
    })
  })

  it('an eligible state with no attribution records keeps the unknown verbatim', async () => {
    const noGate = await capHitBundle({ records: [], metered: true })
    expect(unknownReasonOf(r2EligibilityRate(noGate, true))).toMatch(/no gate\/auto-decision records/u)
  })

  it('a memo-less run degrades its cost-unknown states to the reduced-coverage unknown', async () => {
    const bundle = await capHitBundle({ records: ['R4:gate'], metered: undefined, withState: false })
    expect(unknownReasonOf(r2EligibilityRate(bundle, false))).toMatch(/metered/u)
  })

  it('a memo-less cost-known run still attributes over-ceiling', async () => {
    const bundle = await capHitBundle({ records: ['R4:gate'], metered: undefined, withState: false })
    expect(r2EligibilityRate(bundle, true)).toEqual({
      status: 'known',
      value: { eligible: 1, gateStates: 1, byCause: { 'over-ceiling': 1 } },
    })
  })

  it('a memo predating the metered field degrades cost-unknown states too', async () => {
    const bundle = await capHitBundle({ records: ['R4:gate'], metered: undefined, withState: true })
    expect(unknownReasonOf(r2EligibilityRate(bundle, false))).toMatch(/metered/u)
  })

  it('a run with no convergence pairs reports the metric unknown', async () => {
    const workDir = makeDir('afk-nor2-')
    writeRun(workDir, 'quiet', { events: [stageEnterLine('intake', 1, T0)] })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'quiet')
    expect(r2EligibilityRate(bundle, true)).toEqual({
      status: 'unknown',
      reason: 'no cap-hit convergence pairs',
    })
  })
})

describe('analyze-gates — decision-record consistency audit (D9)', () => {
  it('a stale memo is flagged with its diverging fields, without failing', async () => {
    const workDir = makeDir('afk-stale-')
    writeRun(workDir, 'stale', {
      state: { stage: 'review', round: 3 },
      events: [stageEnterLine('intake', 1, T0), stageEnterLine('draft', 2, at(1_000))],
    })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'stale')
    const audit = decisionConsistency(bundle)
    expect(audit.memoDivergingFields).toContain('stage')
    expect(audit.memoDivergingFields).toContain('round')
    expect(audit.eraContaminated).toBe(false)
  })

  it('a fresh memo — recomputed field for field from the log — raises no flag', async () => {
    const workDir = makeDir('afk-fresh-')
    const stamped = [stampEvent({ altitude: 'L2', type: 'stage_enter', stage: 'intake' }, 1, T0)]
    const snapshot = foldEvents(pipelineMachine, stamped).snapshot
    const halted = haltedOf(snapshot.status)
    const derived = memoFieldsOf(stamped, snapshot.context, halted, flattenPosition(snapshot.value))
    writeRun(workDir, 'fresh', { state: { ...derived }, events: stamped.map((event) => JSON.stringify(event)) })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'fresh')
    expect(decisionConsistency(bundle).memoDivergingFields).toEqual([])
  })

  it('an answered event with no presented of that version is flagged and era-contaminates', async () => {
    const workDir = makeDir('afk-phantom-')
    writeRun(workDir, 'phantom', {
      events: [stageEnterLine('intake', 1, T0), gateLine('answered', 'early', 7, 2, at(1_000), 'veto')],
    })
    const audit = decisionConsistency(await loadRunBundle(nodeAnalyzeFs(), workDir, 'phantom'))
    expect(audit.answeredWithoutPresented).toEqual([7])
    expect(audit.eraContaminated).toBe(true)
  })

  it('completion after an unsuperseded abort is flagged and era-contaminates', async () => {
    const workDir = makeDir('afk-zombie-')
    writeRun(workDir, 'zombie', {
      state: { status: 'completed' },
      events: [stageEnterLine('intake', 1, T0)],
      gateFiles: { 'gate-1.md': 'ABORT\n' },
    })
    const audit = decisionConsistency(await loadRunBundle(nodeAnalyzeFs(), workDir, 'zombie'))
    expect(audit.completedAfterUnsupersededAbort).toBe(true)
    expect(audit.eraContaminated).toBe(true)
  })

  it('an abort superseded by a later presented-and-answered gate does not contaminate', async () => {
    const workDir = makeDir('afk-healed-')
    writeRun(workDir, 'healed', {
      state: { status: 'completed' },
      events: [
        stageEnterLine('intake', 1, T0),
        gateLine('presented', 'early', 1, 2, at(1_000)),
        gateLine('answered', 'early', 1, 3, at(2_000), 'abort'),
        gateLine('presented', 'final', 2, 4, at(3_000)),
        gateLine('answered', 'final', 2, 5, at(4_000), 'approve'),
      ],
      gateFiles: { 'gate-1.md': 'ABORT\n' },
    })
    const audit = decisionConsistency(await loadRunBundle(nodeAnalyzeFs(), workDir, 'healed'))
    expect(audit.completedAfterUnsupersededAbort).toBe(false)
    expect(audit.eraContaminated).toBe(false)
  })

  it('backup residue and gate files recording a decision with no answered event are flagged', async () => {
    const workDir = makeDir('afk-residue-')
    writeRun(workDir, 'residue', {
      events: [stageEnterLine('intake', 1, T0)],
      stateBak: true,
      gateFiles: { 'gate-2.md': 'APPROVE\n' },
    })
    const audit = decisionConsistency(await loadRunBundle(nodeAnalyzeFs(), workDir, 'residue'))
    expect(audit.bakResidue).toBe(true)
    expect(audit.gateFilesWithoutAnsweredEvent).toEqual([2])
    // residue and an orphan decision file are audit flags, not era signatures
    expect(audit.eraContaminated).toBe(false)
  })

  it('the current pending gate version is exempt from the answered-event check', async () => {
    const workDir = makeDir('afk-pending-')
    writeRun(workDir, 'pending', {
      state: { status: 'running', gate: { mode: 'early', version: 3 } },
      events: [stageEnterLine('intake', 1, T0), gateLine('presented', 'early', 3, 2, at(1_000))],
      gateFiles: { 'gate-3.md': '## Gate\n(answered mid-edit is not our case — pending file)\n' },
    })
    const audit = decisionConsistency(await loadRunBundle(nodeAnalyzeFs(), workDir, 'pending'))
    expect(audit.gateFilesWithoutAnsweredEvent).toEqual([])
  })
})

/** A scripted read-only git seam: `log` counts commits, `ls-tree` answers per (ref, path). */
function fakeGit(options: {
  readonly commitsByChange?: Record<string, number>
  readonly mainRefs?: readonly string[]
  readonly onMain?: Record<string, boolean>
  readonly fail?: boolean
}): AnalyzeGit {
  return (_cwd, args) => {
    if (options.fail === true) return Promise.reject(new Error('git exploded'))
    const subcommand = args[0] ?? ''
    if (subcommand === 'log') {
      const target = args[args.indexOf('--') + 1] ?? ''
      const change = path.basename(target)
      const count = options.commitsByChange?.[change] ?? 0
      return Promise.resolve({
        stdout: Array.from({ length: count }, (_, i) => `hash${i} message`).join('\n'),
        stderr: '',
      })
    }
    if (subcommand === 'ls-tree') {
      const ref = args[1] ?? ''
      const target = args[2] ?? ''
      const change = path.basename(target)
      const mainRefs = options.mainRefs ?? ['main']
      const onMain = options.onMain?.[change] === true && mainRefs.includes(ref)
      return Promise.resolve({ stdout: onMain ? '040000 tree abc\topenspec/changes/' : '', stderr: '' })
    }
    return Promise.resolve({ stdout: '', stderr: '' })
  }
}

function writeChangeWithTasks(repoRoot: string, changeName: string, done: number, total: number): void {
  const changeDir = path.join(repoRoot, 'openspec', 'changes', changeName)
  fs.mkdirSync(changeDir, { recursive: true })
  const lines = Array.from({ length: total }, (_, i) => (i < done ? `- [x] task ${i + 1}` : `- [ ] task ${i + 1}`))
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), `# Tasks\n\n${lines.join('\n')}\n`)
}

describe('analyze-truth — the ground-truth join', () => {
  it('reports tasks, commits, and main-ref presence per change folder', async () => {
    const repoRoot = makeDir('afk-truth-')
    writeChangeWithTasks(repoRoot, 'half-done', 1, 3)
    const [truth] = await groundTruthJoin(nodeAnalyzeFs(), fakeGit({ commitsByChange: { 'half-done': 4 } }), [
      { repoRoot, changeName: 'half-done' },
    ])
    expect(truth).toMatchObject({
      changeName: 'half-done',
      repoRoot,
      exists: true,
      tasksDone: 1,
      tasksTotal: 3,
      commits: 4,
      onMainBranch: false,
      strandedComplete: false,
      mergedUnimplemented: false,
    })
  })

  it('stranded-complete: planning done and absent from every main ref', async () => {
    const repoRoot = makeDir('afk-stranded-')
    writeChangeWithTasks(repoRoot, 'stranded-change', 3, 3)
    const [truth] = await groundTruthJoin(nodeAnalyzeFs(), fakeGit({ commitsByChange: { 'stranded-change': 2 } }), [
      { repoRoot, changeName: 'stranded-change' },
    ])
    expect(truth?.strandedComplete).toBe(true)
    expect(truth?.mergedUnimplemented).toBe(false)
  })

  it('merged-unimplemented: on a main ref with zero tasks done', async () => {
    const repoRoot = makeDir('afk-merged-')
    writeChangeWithTasks(repoRoot, 'merged-empty', 0, 3)
    const [truth] = await groundTruthJoin(
      nodeAnalyzeFs(),
      fakeGit({ onMain: { 'merged-empty': true }, commitsByChange: { 'merged-empty': 1 } }),
      [{ repoRoot, changeName: 'merged-empty' }],
    )
    expect(truth?.onMainBranch).toBe(true)
    expect(truth?.mergedUnimplemented).toBe(true)
    expect(truth?.strandedComplete).toBe(false)
  })

  it('checks every configured main-ref candidate, first match wins', async () => {
    const repoRoot = makeDir('afk-master-')
    writeChangeWithTasks(repoRoot, 'on-master', 0, 2)
    const refs = [...MAIN_REF_CANDIDATES]
    const [truth] = await groundTruthJoin(
      nodeAnalyzeFs(),
      fakeGit({ onMain: { 'on-master': true }, mainRefs: ['master'] }),
      [{ repoRoot, changeName: 'on-master' }],
    )
    expect(refs).toEqual(['main', 'master'])
    expect(truth?.onMainBranch).toBe(true)
  })

  it('dedupes (repoRoot, changeName) pairs and degrades a failing git seam to zero/not-on-main', async () => {
    const repoRoot = makeDir('afk-dedupe-')
    writeChangeWithTasks(repoRoot, 'dup', 1, 2)
    const truth = await groundTruthJoin(nodeAnalyzeFs(), fakeGit({ fail: true }), [
      { repoRoot, changeName: 'dup' },
      { repoRoot, changeName: 'dup' },
    ])
    expect(truth).toHaveLength(1)
    expect(truth[0]).toMatchObject({ commits: 0, onMainBranch: false })
  })
})

describe('shared usage helpers (one home beside usageTotalsOf)', () => {
  it('EMPTY_USAGE is the zero usage; plusUsage sums every field', () => {
    expect(EMPTY_USAGE).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0,
      wallMs: 0,
    })
    const left: AgentUsage = { ...EMPTY_USAGE, inputTokens: 10, outputTokens: 1, costUsd: 0.25, wallMs: 100 }
    const right: AgentUsage = { ...EMPTY_USAGE, reasoningTokens: 2, cachedReadTokens: 3, costUsd: 0.5, wallMs: 50 }
    expect(plusUsage(left, right)).toEqual({
      inputTokens: 10,
      outputTokens: 1,
      reasoningTokens: 2,
      cachedReadTokens: 3,
      cachedWriteTokens: 0,
      costUsd: 0.75,
      wallMs: 150,
    })
  })
})

describe('analyze-usage — the usage fold', () => {
  it('per-role usage joins spawned agents to roles; unjoined agents key by name', async () => {
    const workDir = makeDir('afk-usage-')
    const spawnedLine = (agent: string, role: string, seq: number, ts: string): string =>
      JSON.stringify({ altitude: 'L1', type: 'spawned', agent, role, model: 'm', seq, ts })
    writeRun(workDir, 'spendy', {
      events: [
        spawnedLine('agent-1', 'reviewer', 1, T0),
        doneLine('agent-1', { inputTokens: 100, costUsd: 0.25, wallMs: 1_000 }, 2, at(1_000)),
        doneLine('loose-agent', { inputTokens: 40, costUsd: 0.1, wallMs: 500 }, 3, at(2_000)),
      ],
    })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'spendy')
    const usage = usageOf(bundle.events)
    expect(usage.byRole).toEqual({
      reviewer: { ...EMPTY_USAGE, inputTokens: 100, costUsd: 0.25, wallMs: 1_000 },
      'loose-agent': { ...EMPTY_USAGE, inputTokens: 40, costUsd: 0.1, wallMs: 500 },
    })
    expect(usage.costKnown).toBe(true)
    expect(usage.unpricedEvents).toBe(0)
  })

  it('per-round usage assigns each done to the round_open ts-window that contains it', async () => {
    const workDir = makeDir('afk-rounds-')
    writeRun(workDir, 'windows', {
      events: [
        // a pre-review done lands in round 0
        doneLine('estimator', { inputTokens: 10, costUsd: 0.05 }, 1, at(0)),
        roundOpenLine(1, 2, 2, at(10_000)),
        doneLine('reviewer', { inputTokens: 100, costUsd: 0.25 }, 3, at(20_000)),
        roundOpenLine(2, 2, 4, at(30_000)),
        // a done stamped before round 2's open stays in round 1 — ts-window, not log order
        doneLine('resolver', { inputTokens: 50, costUsd: 0.15 }, 5, at(25_000)),
        doneLine('reviewer', { inputTokens: 70, costUsd: 0.2 }, 6, at(40_000)),
      ],
    })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'windows')
    const usage = usageOf(bundle.events)
    expect(usage.byRound).toEqual({
      0: { ...EMPTY_USAGE, inputTokens: 10, costUsd: 0.05 },
      1: { ...EMPTY_USAGE, inputTokens: 150, costUsd: 0.4 },
      2: { ...EMPTY_USAGE, inputTokens: 70, costUsd: 0.2 },
    })
  })

  it('costKnown follows usageTotalsOf semantics with the unpriced count alongside', async () => {
    const workDir = makeDir('afk-unpriced-')
    writeRun(workDir, 'unpriced', {
      events: [
        doneLine('a', { inputTokens: 100, costUsd: 0.25 }, 1, at(0)),
        doneLine('b', { inputTokens: 50, costUsd: 0 }, 2, at(1_000)),
        doneLine('c', { inputTokens: 0, costUsd: 0 }, 3, at(2_000)),
      ],
    })
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'unpriced')
    const usage = usageOf(bundle.events)
    expect(usage.costKnown).toBe(false)
    expect(usage.unpricedEvents).toBe(1)
    // a zero-token zero-cost done is not an unpriced event
    expect(usage.byRole['c']).toEqual({ ...EMPTY_USAGE })
  })
})

/** The corpus fixture: one clean cap-hit run with gate/r2/usage data, one era-contaminated run. */
async function corpusReportFixture(): Promise<ReturnType<typeof buildCorpusReport>> {
  const workDir = makeDir('afk-corpus-')
  writeRun(workDir, 'add-thing', {
    state: {
      changeName: 'add-thing',
      status: 'completed',
      metered: true,
      stage: 'intake',
      depth: null,
      round: 2,
      roundCap: 2,
    },
    events: [
      roundOpenLine(1, 2, 1, T0),
      convergenceLine(1, 'open', { blocker: 0, material: 3, nitpick: 0 }, 2, at(1_000)),
      roundOpenLine(2, 2, 3, at(2_000)),
      convergenceLine(2, 'open', { blocker: 0, material: 1, nitpick: 0 }, 4, at(3_000)),
      gateLine('presented', 'early', 1, 5, at(4_000)),
      autoDecisionLine('R4', 'gate', 1, 6, at(5_000)),
      gateLine('answered', 'early', 1, 7, at(6_000), 'veto'),
      doneLine('reviewer', { inputTokens: 100, costUsd: 0.25 }, 8, at(7_000)),
      doneLine('resolver', { inputTokens: 50, costUsd: 0 }, 9, at(8_000)),
    ],
    sidecars: {
      'resolutions-1.json': JSON.stringify({
        resolutions: [resolutionOf('F1', 'MATERIAL', 'edited'), resolutionOf('F1', 'MATERIAL', 'edited')],
      }),
    },
  })
  writeRun(workDir, 'era-run', {
    state: { changeName: 'era-run', status: 'completed' },
    events: [gateLine('answered', 'early', 1, 1, T0, 'veto')],
  })
  const repoRoot = makeDir('afk-corpus-repo-')
  writeChangeWithTasks(repoRoot, 'add-thing', 3, 3)
  const bundles = await loadCorpus(nodeAnalyzeFs(), [workDir])
  const groundTruth = await groundTruthJoin(nodeAnalyzeFs(), fakeGit({ commitsByChange: { 'add-thing': 2 } }), [
    { repoRoot, changeName: 'add-thing' },
  ])
  return buildCorpusReport(bundles, groundTruth, { now: NOW })
}

describe('analyze-corpus — assembly and aggregates', () => {
  it('composes per-run analysis and excludes era-contaminated runs from the aggregates', async () => {
    const report = await corpusReportFixture()
    expect(report.runs).toHaveLength(2)
    expect(report.workdirs).toHaveLength(1)
    const good = report.runs.find((run) => run.runId === 'add-thing')
    const era = report.runs.find((run) => run.runId === 'era-run')
    expect(good?.eraContaminated).toBe(false)
    expect(good?.usage.costKnown).toBe(false)
    expect(era?.eraContaminated).toBe(true)
    expect(report.aggregates.runsAggregated).toBe(1)
    expect(report.aggregates.eraContaminated).toEqual(['era-run'])
    expect(report.aggregates.autoDecisionsByRule).toEqual({ R4: 1 })
    expect(report.aggregates.duplicateResolutionEntries).toBe(1)
    expect(report.aggregates.gatesNeverAnswered).toBe(0)
    expect(report.aggregates.strandedComplete).toEqual(['add-thing'])
    expect(report.aggregates.mergedUnimplemented).toEqual([])
  })

  it('per-cause sums across known runs carry the metered cost-unknown cell', async () => {
    const report = await corpusReportFixture()
    expect(report.aggregates.r2Eligibility).toEqual({
      eligible: 1,
      gateStates: 1,
      byCause: { 'cost-unknown': 1 },
    })
  })
})

describe('analyze-report — plain text and JSON over the same structure', () => {
  it('renders per-run sections, the corpus aggregate, and the ground-truth sections, no ANSI', async () => {
    const report = await corpusReportFixture()
    const text = renderCorpusReport(report)
    expect(text).toContain('corpus analysis')
    expect(text).toContain('## run add-thing')
    expect(text).toContain('add-thing · completed')
    expect(text).toContain('r2 eligibility: 1/1')
    expect(text).toContain('cost-unknown ×1')
    expect(text).toContain('usage:')
    expect(text).toContain('reviewer $0.25')
    expect(text).toContain('≥ $0.25')
    expect(text).toContain('cost unknown')
    expect(text).toContain('consistency: clean')
    expect(text).toContain('## corpus')
    expect(text).toContain('excluded era-contaminated: era-run')
    expect(text).toContain('## stranded-complete')
    expect(text).toContain('add-thing — 3/3 tasks, 2 commits, not on a main ref')
    expect(text).toContain('## merged-unimplemented')
    expect(text).toContain('none')
    expect(text).not.toContain('\u001b[')
  })

  it('flags a divergent memo in the consistency section, naming the fields', async () => {
    const workDir = makeDir('afk-report-stale-')
    writeRun(workDir, 'stale', {
      state: { stage: 'review' },
      events: [stageEnterLine('draft', 1, T0)],
    })
    const bundles = await loadCorpus(nodeAnalyzeFs(), [workDir])
    const report = buildCorpusReport(bundles, [], { now: NOW })
    const text = renderCorpusReport(report)
    expect(text).toContain('stale memo')
    expect(text).toContain('stage')
  })

  it('--json emits the same structure machine-readably', async () => {
    const report = await corpusReportFixture()
    const parsed: unknown = JSON.parse(renderCorpusJson(report))
    expect(parsed).toMatchObject({
      runs: [{ runId: 'add-thing' }, { runId: 'era-run' }],
      aggregates: { r2Eligibility: { byCause: { 'cost-unknown': 1 } } },
    })
  })
})
