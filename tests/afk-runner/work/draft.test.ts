// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { RunnerConfig } from '../../../afk-runner/src/config.js'
import { createOpenSpecDriver } from '../../../afk-runner/src/openspec-driver.js'
import type { ExecFn } from '../../../afk-runner/src/openspec-driver.js'
import { draftArtifacts, runDraft } from '../../../afk-runner/src/work/draft.js'
import type { DraftDeps } from '../../../afk-runner/src/work/draft.js'
import { StageHaltError } from '../../../afk-runner/src/work/stage-halt.js'
import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-draft-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('draftArtifacts', () => {
  it('skips design.md at S', () => {
    expect(draftArtifacts('S')).toEqual(['proposal', 'specs'])
  })

  it('drafts design.md at M and L', () => {
    expect(draftArtifacts('M')).toEqual(['proposal', 'specs', 'design'])
    expect(draftArtifacts('L')).toEqual(['proposal', 'specs', 'design'])
  })
})

interface ArtifactWrite {
  readonly files: Record<string, string>
  readonly report?: string
}

interface DraftFixture {
  readonly deps: DraftDeps
  readonly prompts: string[]
  readonly instructionCalls: string[]
  readonly dir: string
}

function makeFixture(dir: string, script: Record<string, ArtifactWrite[]>, validateResults?: boolean[]): DraftFixture {
  const prompts: string[] = []
  const instructionCalls: string[] = []
  const callCounts: Record<string, number> = {}
  const validations = [...(validateResults ?? [])]
  const exec: ExecFn = (args) => {
    const key = args.join(' ')
    if (key.includes('instructions')) {
      const artifact = args[2] ?? 'unknown'
      instructionCalls.push(artifact)
      return Promise.resolve({
        stdout: JSON.stringify({
          instruction: `Write the ${artifact} artifact.`,
          template: `## ${artifact} template\n`,
          rules: [`rule for ${artifact}`],
          resolvedOutputPath: `${dir}/openspec/changes/add-thing/${artifact}.md`,
          existingOutputPaths: [],
          dependencies: [],
        }),
        stderr: '',
        exitCode: 0,
      })
    }
    if (key.includes('validate')) {
      const ok = validations.shift() ?? true
      return Promise.resolve({
        stdout: ok ? 'is valid' : 'has issues: specs delta malformed',
        stderr: '',
        exitCode: ok ? 0 : 1,
      })
    }
    return Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 })
  }
  const config: RunnerConfig = {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'test-model',
    budget: 5,
  }
  const spawn: SpawnFn = (_command, args, options) => {
    prompts.push(String(args[args.length - 1]))
    const artifact = instructionCalls[instructionCalls.length - 1] ?? 'unknown'
    const index = callCounts[artifact] ?? 0
    callCounts[artifact] = index + 1
    const writes = script[artifact] ?? []
    const outcome = writes[Math.min(index, writes.length - 1)] ?? { files: {} }
    for (const [rel, content] of Object.entries(outcome.files)) {
      const target = path.join(dir, rel)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content)
    }
    const basename = `draft-${artifact}.json`
    const target = agentWritePath(options.cwd, basename)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const report = outcome.report ?? JSON.stringify({ files_written: Object.keys(outcome.files) })
    fs.writeFileSync(target, report)
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  const execGit = (): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout: '', stderr: '' })
  const deps: DraftDeps = {
    driver: createOpenSpecDriver({ exec, cwd: dir }),
    agent: { spawn, config, execGit, emit: () => undefined },
    runDir: dir,
    sidecarDir: path.join(dir, 'sidecars'),
    cwd: dir,
  }
  return { deps, prompts, instructionCalls, dir }
}

describe('runDraft', () => {
  it('drafts proposal then specs at S, injecting instructions and rules into prompts', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, {
      proposal: [{ files: { 'openspec/changes/add-thing/proposal.md': '## Why\nx\n' } }],
      specs: [{ files: { 'openspec/changes/add-thing/specs/thing/spec.md': '## ADDED Requirements\n' } }],
    })
    await runDraft(fixture.deps, { changeName: 'add-thing', taskText: 'add a thing', depth: 'S' })
    expect(fixture.instructionCalls).toEqual(['proposal', 'specs'])
    expect(fixture.prompts[0]).toContain('Write the proposal artifact.')
    expect(fixture.prompts[0]).toContain('rule for proposal')
    expect(fixture.prompts[0]).toContain('add a thing')
    expect(fs.existsSync(path.join(dir, 'openspec/changes/add-thing/proposal.md'))).toBe(true)
  })

  it('retries an artifact when a reported file is missing, appending the error', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, {
      proposal: [
        { files: {}, report: '{"files_written":["openspec/changes/add-thing/proposal.md"]}' },
        { files: { 'openspec/changes/add-thing/proposal.md': '## Why\nx\n' } },
      ],
      specs: [{ files: { 'openspec/changes/add-thing/specs/thing/spec.md': '## ADDED Requirements\n' } }],
    })
    await runDraft(fixture.deps, { changeName: 'add-thing', taskText: 'add a thing', depth: 'S' })
    const proposalPrompts = fixture.prompts.filter((p) => p.includes('Write the proposal artifact.'))
    expect(proposalPrompts).toHaveLength(2)
    expect(proposalPrompts[1]).toContain('missing')
  })

  it('retries the specs drafter when openspec validate fails, appending the validation output', async () => {
    const dir = makeDir()
    const fixture = makeFixture(
      dir,
      {
        proposal: [{ files: { 'openspec/changes/add-thing/proposal.md': '## Why\nx\n' } }],
        specs: [
          { files: { 'openspec/changes/add-thing/specs/thing/spec.md': 'bad delta\n' } },
          { files: { 'openspec/changes/add-thing/specs/thing/spec.md': '## ADDED Requirements\n' } },
        ],
      },
      [false, true],
    )
    await runDraft(fixture.deps, { changeName: 'add-thing', taskText: 'add a thing', depth: 'S' })
    const specsPrompts = fixture.prompts.filter((p) => p.includes('Write the specs artifact.'))
    expect(specsPrompts).toHaveLength(2)
    expect(specsPrompts[1]).toContain('specs delta malformed')
  })

  it('halts resumable when an artifact cannot be drafted in two attempts', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, {
      proposal: [
        { files: {}, report: '{"files_written":["openspec/changes/add-thing/proposal.md"]}' },
        { files: {}, report: '{"files_written":["openspec/changes/add-thing/proposal.md"]}' },
      ],
      specs: [{ files: { 'openspec/changes/add-thing/specs/thing/spec.md': '## ADDED Requirements\n' } }],
    })
    const run = runDraft(fixture.deps, { changeName: 'add-thing', taskText: 'add a thing', depth: 'S' })
    await expect(run).rejects.toThrow(StageHaltError)
  })
})
