// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import type { Finding } from '../../sdd-runner/src/agent-layer.js'
import type { RunnerConfig } from '../../sdd-runner/src/config.js'
import { EventInputSchema } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import { resolveRound, runLenses } from '../../sdd-runner/src/review-agents.js'
import type { ReviewLoopDeps } from '../../sdd-runner/src/review-loop.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-rag-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'F1',
  class: 'MATERIAL',
  gap: 'the proposal never names the scope id',
  question: 'q',
  code_evidence_attempted: 'e',
  ...overrides,
})

interface AgentsFixture {
  readonly deps: ReviewLoopDeps
  readonly changeDir: string
  readonly prompts: Map<string, string>
}

function makeAgentsFixture(dir: string, script: Record<string, string>): AgentsFixture {
  const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
  fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nstorage lands via a drizzle migration\n')
  fs.writeFileSync(path.join(changeDir, 'design.md'), '## Context\nschema ships as a hand-written migration\n')
  fs.writeFileSync(
    path.join(changeDir, 'specs', 'thing', 'spec.md'),
    '## ADDED Requirements\n### Requirement: X\n\nIt SHALL x.\n',
  )
  const emitted: EventInput[] = []
  const prompts = new Map<string, string>()
  const config: RunnerConfig = { repoRoot: dir, workDir: path.join(dir, '.sdd-runner'), model: 'test-model', budget: 5 }
  const spawn: SpawnFn = (_command, args, options) => {
    const prompt = String(args[args.length - 1])
    const match = prompt.match(/\.review-loop\/([\w-]+\.json)/u)
    const basename = match?.[1] ?? 'unknown.json'
    prompts.set(basename, prompt)
    const target = path.join(options.cwd, '.review-loop', basename)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, script[basename] ?? '{"findings":[]}')
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  const deps: ReviewLoopDeps = {
    agent: { spawn, config, execGit: () => Promise.resolve({ stdout: '', stderr: '' }), emit: () => undefined },
    emit: (event) => {
      emitted.push(EventInputSchema.parse(event))
    },
    sidecarDir: path.join(dir, 'sidecars'),
    runDir: dir,
    cwd: dir,
    materialize: () => Promise.resolve(),
  }
  return { deps, changeDir, prompts }
}

const options = { changeName: 'add-thing', depth: 'L' as const, taskText: 'x', conventions: 'y', changeDir: '' }

describe('runLenses (review-agents)', () => {
  it('merges lens findings by fingerprint and appends the consistency scan', async () => {
    const dir = makeDir()
    const fixture = makeAgentsFixture(dir, {
      'findings-1.json': JSON.stringify({ findings: [finding()] }),
      'findings-skeptic-1.json': JSON.stringify({
        findings: [finding({ id: 'S1', gap: 'The proposal never names the scope ID!' })],
      }),
    })
    const merged = await runLenses(fixture.deps, { ...options, changeDir: fixture.changeDir }, 1, 0, undefined)
    const ids = merged.map((entry) => entry.id)
    expect(ids).toEqual(['F1', 'C1'])
    expect(merged[1]?.gap).toContain('drizzle migration')
    expect(merged[1]?.gap).toContain('hand-written migration')
  })
})

describe('resolveRound (review-agents)', () => {
  const isResolvedFinding = (event: EventInput): event is Extract<EventInput, { type: 'finding' }> =>
    event.type === 'finding' && event.action === 'resolved'

  it('resolves merged findings and emits fingerprinted resolution events', async () => {
    const dir = makeDir()
    const fixture = makeAgentsFixture(dir, {
      'resolutions-1.json': JSON.stringify({
        resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'edited', outcome: 'fixed' }],
        assumptions: [],
      }),
    })
    const emitted: EventInput[] = []
    const deps: ReviewLoopDeps = {
      ...fixture.deps,
      emit: (event) => {
        emitted.push(EventInputSchema.parse(event))
      },
    }
    const merged: readonly Finding[] = [finding()]
    const resolved = await resolveRound(deps, { ...options, changeDir: fixture.changeDir }, 1, merged, undefined)
    expect(resolved.resolutions).toHaveLength(1)
    const resolutionEvent = emitted.find(isResolvedFinding)
    expect(resolutionEvent?.fingerprint).toBe('id names never proposal scope')
  })
})
