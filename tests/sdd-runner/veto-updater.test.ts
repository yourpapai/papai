// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import type { AgentLayerDeps } from '../../sdd-runner/src/agent-layer.js'
import type { StageContext } from '../../sdd-runner/src/gate-digest.js'
import type { OpenSpecDriver, ValidateResult } from '../../sdd-runner/src/openspec-driver.js'
import { ResolverOutputSchema } from '../../sdd-runner/src/review-loop.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'
import {
  buildVetoUpdaterPrompt,
  runVetoUpdater,
  updateAssumptionsFromVetoes,
} from '../../sdd-runner/src/veto-updater.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-veto-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('buildVetoUpdaterPrompt', () => {
  it('names vetoed assumptions and findings with their redirects, current artifact content, and the report sidecar path', () => {
    const prompt = buildVetoUpdaterPrompt({
      changeName: 'add-thing',
      assumptions: [{ id: 'A1', text: 'guests stay read-only', blast_radius: 'plugin layer' }],
      findings: [{ id: 'F1', gap: 'design lacks rollback', evidence: 'edited — narrowed' }],
      vetoes: [
        { id: 'A1', redirect: 'suppress autonomous replies only' },
        { id: 'F1', redirect: 'restructure around a format-helper import' },
      ],
      artifacts: {
        proposal: '## Why\nbody\n',
        design: '## Context\nbody\n',
        specs: '## ADDED Requirements\n',
        tasks: '## 1. Section\n- [ ] 1.1 task\n',
      },
      reportPath: '/repo/.review-loop/veto-updater.json',
    })
    expect(prompt).toContain('add-thing')
    expect(prompt).toContain('A1')
    expect(prompt).toContain('guests stay read-only')
    expect(prompt).toContain('suppress autonomous replies only')
    expect(prompt).toContain('F1')
    expect(prompt).toContain('design lacks rollback')
    expect(prompt).toContain('restructure around a format-helper import')
    expect(prompt).toContain('## Why\nbody\n')
    expect(prompt).toContain('## Context\nbody\n')
    expect(prompt).toContain('## ADDED Requirements\n')
    expect(prompt).toContain('## 1. Section\n- [ ] 1.1 task\n')
    expect(prompt).toContain('/repo/.review-loop/veto-updater.json')
    expect(prompt).toContain('files_updated')
    expect(prompt.toLowerCase()).toContain('stale')
    expect(prompt.toLowerCase()).toContain('apply')
  })

  it('omits the assumptions section when no assumption vetoes and omits findings section when no finding vetoes', () => {
    const prompt = buildVetoUpdaterPrompt({
      changeName: 'add-thing',
      assumptions: [{ id: 'A1', text: 'a-text', blast_radius: 'b' }],
      findings: [{ id: 'F1', gap: 'f-gap', evidence: 'e' }],
      vetoes: [{ id: 'A1', redirect: 'a-redirect' }],
      artifacts: { proposal: 'p' },
      reportPath: '/r/veto-updater.json',
    })
    expect(prompt).toContain('Vetoed assumptions')
    expect(prompt).not.toContain('Vetoed findings')
  })
})

describe('updateAssumptionsFromVetoes', () => {
  it("updates a vetoed assumption's text to the redirect, marks no-redirect assumptions vetoed, and applies finding redirects to the matching resolution's outcome", async () => {
    const dir = makeDir()
    const sidecarPath = path.join(dir, 'resolutions-2.json')
    fs.writeFileSync(
      sidecarPath,
      JSON.stringify({
        resolutions: [
          { id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'old outcome' },
          { id: 'F2', class: 'MATERIAL', resolution: 'assumed', outcome: 'old f2' },
        ],
        assumptions: [
          {
            id: 'A1',
            text: 'original a1',
            basis: 'default',
            confidence: 'medium',
            blast_radius: 'r1',
            status: 'open',
            evidence: { files: ['a.md'] },
          },
          {
            id: 'A2',
            text: 'original a2',
            basis: 'code-evidence',
            confidence: 'high',
            blast_radius: 'r2',
            status: 'open',
            evidence: { files: ['b.md'] },
          },
        ],
      }),
    )

    await updateAssumptionsFromVetoes(dir, 2, [
      { id: 'A1', redirect: 'narrowed a1' },
      { id: 'A2' },
      { id: 'F1', redirect: 'restructure the helper' },
    ])

    const updated = ResolverOutputSchema.parse(JSON.parse(fs.readFileSync(sidecarPath, 'utf8')))
    expect(updated.assumptions).toEqual([
      {
        id: 'A1',
        text: 'narrowed a1',
        basis: 'default',
        confidence: 'medium',
        blast_radius: 'r1',
        status: 'open',
        evidence: { files: ['a.md'] },
      },
      {
        id: 'A2',
        text: 'original a2',
        basis: 'code-evidence',
        confidence: 'high',
        blast_radius: 'r2',
        status: 'vetoed',
        evidence: { files: ['b.md'] },
      },
    ])
    expect(updated.resolutions).toEqual([
      { id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'restructure the helper' },
      { id: 'F2', class: 'MATERIAL', resolution: 'assumed', outcome: 'old f2' },
    ])
  })

  it('is a no-op when the sidecar does not exist', async () => {
    const dir = makeDir()
    await expect(updateAssumptionsFromVetoes(dir, 3, [{ id: 'A1', redirect: 'x' }])).resolves.toBeUndefined()
    expect(fs.existsSync(path.join(dir, 'resolutions-3.json'))).toBe(false)
  })
})

describe('runVetoUpdater', () => {
  interface UpdaterFixture {
    readonly deps: { readonly driver: OpenSpecDriver; readonly agent: AgentLayerDeps }
    readonly state: RunState
    readonly ctx: StageContext
    readonly spawnCount: () => number
    readonly validateCount: () => number
    readonly changeDir: string
  }

  function makeUpdaterFixture(validateResults: ValidateResult[] = [{ ok: true, output: 'is valid' }]): UpdaterFixture {
    const repoRoot = makeDir()
    const changeName = 'add-thing'
    const changeDir = path.join(repoRoot, 'openspec', 'changes', changeName)
    fs.mkdirSync(changeDir, { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nbody\n')
    const workDir = path.join(repoRoot, '.sdd-runner')
    const runDir = path.join(workDir, 'runs', 'test-run')
    const sidecarDir = path.join(runDir, 'sidecars')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(
      path.join(sidecarDir, 'resolutions-1.json'),
      JSON.stringify({
        resolutions: [],
        assumptions: [
          {
            id: 'A1',
            text: 'original',
            basis: 'default',
            confidence: 'medium',
            blast_radius: 'r',
            status: 'open',
            evidence: { files: ['c.md'] },
          },
        ],
      }),
    )
    const state: RunState = {
      runId: 'test-run',
      repoRoot,
      workDir,
      changeName,
      stage: 'gate',
      depth: 'S',
      round: 1,
      gate: { mode: 'final', version: 1 },
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      runDir,
      statePath: path.join(runDir, 'state.json'),
    }
    const ctx: StageContext = { cwd: repoRoot, changeDir, sidecarDir, emit: () => {} }
    let spawnCount = 0
    const spawn: SpawnFn = (_command, _args, options) => {
      spawnCount += 1
      const target = agentWritePath(options.cwd, 'veto-updater.json')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, JSON.stringify({ files_updated: ['openspec/changes/add-thing/proposal.md'] }))
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    }
    let validateCount = 0
    const driver: OpenSpecDriver = {
      newChange: () => Promise.resolve({ changeName }),
      status: () => Promise.resolve({ schemaName: 'spec-driven', artifacts: {}, isPlanningComplete: true }),
      instructions: () =>
        Promise.resolve({
          instruction: '',
          template: undefined,
          rules: [],
          resolvedOutputPath: '',
          existingOutputPaths: [],
          dependencies: [],
        }),
      validateStrict: () => {
        const result = validateResults[Math.min(validateCount, validateResults.length - 1)]
        validateCount += 1
        if (result === undefined) throw new Error('validateResults fixture exhausted')
        return Promise.resolve(result)
      },
    }
    const agent: AgentLayerDeps = {
      spawn,
      config: {
        repoRoot,
        workDir,
        model: 'test',
        models: {},
        timeouts: { wallClockMs: 60_000, inactivityMs: 5_000 },
      },
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      emit: () => {},
    }
    return {
      deps: { driver, agent },
      state,
      ctx,
      spawnCount: () => spawnCount,
      validateCount: () => validateCount,
      changeDir,
    }
  }

  it('spawns a resolver agent, reads files_updated from the report, validates strict, and returns the updated files', async () => {
    const fixture = makeUpdaterFixture()
    const result = await runVetoUpdater(fixture.deps, fixture.state, fixture.ctx, [
      { id: 'A1', redirect: 'narrowed text' },
    ])
    expect(result.filesUpdated).toEqual(['openspec/changes/add-thing/proposal.md'])
    expect(fixture.spawnCount()).toBe(1)
    expect(fixture.validateCount()).toBe(1)
  })

  it('retries once when validation fails, then succeeds', async () => {
    const fixture = makeUpdaterFixture([
      { ok: false, output: 'broken: spec malformed' },
      { ok: true, output: 'is valid' },
    ])
    const result = await runVetoUpdater(fixture.deps, fixture.state, fixture.ctx, [
      { id: 'A1', redirect: 'narrowed text' },
    ])
    expect(result.filesUpdated).toEqual(['openspec/changes/add-thing/proposal.md'])
    expect(fixture.spawnCount()).toBe(2)
    expect(fixture.validateCount()).toBe(2)
  })

  it('throws after the second validation failure', async () => {
    const fixture = makeUpdaterFixture([
      { ok: false, output: 'broken 1' },
      { ok: false, output: 'broken 2' },
    ])
    await expect(
      runVetoUpdater(fixture.deps, fixture.state, fixture.ctx, [{ id: 'A1', redirect: 'narrowed text' }]),
    ).rejects.toThrow(/veto updater failed validation/u)
    expect(fixture.spawnCount()).toBe(2)
  })

  it('builds the prompt from the current artifacts on disk and the veto redirects', async () => {
    const fixture = makeUpdaterFixture()
    let capturedPrompt = ''
    const trackingAgent: AgentLayerDeps = {
      ...fixture.deps.agent,
      spawn: ((cmd, args, options) => {
        capturedPrompt = String(args[args.length - 1])
        return fixture.deps.agent.spawn(cmd, args, options)
      }) as SpawnFn,
    }
    await runVetoUpdater({ driver: fixture.deps.driver, agent: trackingAgent }, fixture.state, fixture.ctx, [
      { id: 'A1', redirect: 'narrowed text' },
    ])
    expect(capturedPrompt).toContain('add-thing')
    expect(capturedPrompt).toContain('narrowed text')
    expect(capturedPrompt).toContain('## Why\nbody\n')
  })
})
