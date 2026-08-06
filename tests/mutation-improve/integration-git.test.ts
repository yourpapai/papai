// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { readBaseline, writeBaseline } from '../../mutation-improve/src/baseline.js'
import type { MutationImproveConfig } from '../../mutation-improve/src/config.js'
import { runPipeline, type PipelineDeps } from '../../mutation-improve/src/pipeline.js'
import type { Result } from '../../mutation-improve/src/result-schema.js'
import { createRunState } from '../../mutation-improve/src/run-state.js'
import type { Selection } from '../../mutation-improve/src/selection-schema.js'
import type { AgentUsage } from '../../review-loop/src/agent-runner.js'
import {
  createWorktree,
  execGit,
  mergeWorktree,
  removeWorktree,
  resetWorktree,
} from '../../review-loop/src/worktree.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const emptyUsage = (): AgentUsage => ({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, wallMs: 0 })

const selection: Selection = {
  file: 'src/foo.ts',
  beforeScore: 0.4,
  rationale: 'x',
  runnerUps: [],
}

const improvedResult: Result = {
  specPath: 'docs/superpowers/specs/x-design.md',
  planPath: 'docs/superpowers/plans/x.md',
  testPaths: ['tests/foo.test.ts'],
  residuals: [],
  notes: '',
}

// Sequence-based measureScore: first call returns scores[0], second scores[1],
// clamped to the last past the end. Kept at module scope so no `??` / ternary
// lives inside a test body (vitest/no-conditional-tests).
const sequenceMeasure = (scores: readonly number[]): PipelineDeps['measureScore'] => {
  let calls = 0
  return (): Promise<number> => {
    calls += 1
    const idx = Math.min(calls - 1, scores.length - 1)
    return Promise.resolve(scores[idx] ?? 0)
  }
}

// C1 regression guard. Uses REAL git for createWorktree / execGit / mergeWorktree
// / removeWorktree and REAL readBaseline / writeBaseline; only the agent
// subprocess, build, and score runner are faked. The pre-fix pipeline never
// committed the worktree, so mergeWorktree was a no-op ("Already up to date"),
// writeBaseline never propagated to base, and removeWorktree --force discarded
// the agent's spec/plan/test files. If C1 regresses, all three assertions below
// fail: no "chore(mutation): ratchet ..." commit on base, tests/foo.test.ts
// missing from base, and baseline.json on base still at 0.4.
describe('integration real-git', () => {
  test('runPipeline commits iteration work before merge and propagates it to base', async () => {
    const repoRoot = makeTempDir('intgit-')
    await execGit(repoRoot, ['init', '--quiet'])
    await execGit(repoRoot, ['config', 'user.email', 't@t.com'])
    await execGit(repoRoot, ['config', 'user.name', 'T'])
    await execGit(repoRoot, ['checkout', '-b', 'master'])
    // Seed a committed baseline.json (0.4) and tests/.gitkeep so the worktree
    // created from HEAD has the baseline file and the tests/ dir.
    mkdirSync(path.join(repoRoot, 'scripts', 'mutation'), { recursive: true })
    await writeBaseline(repoRoot, { 'src/foo.ts': 0.4 })
    mkdirSync(path.join(repoRoot, 'tests'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'tests', '.gitkeep'), '')
    await execGit(repoRoot, ['add', '-A'])
    await execGit(repoRoot, ['commit', '-m', 'init', '--quiet'])

    const config: MutationImproveConfig = {
      repoRoot,
      workDir: path.join(repoRoot, '.mutation-improve'),
      base: 'master',
      upstream: 'origin',
      count: 1,
      threshold: 0.95,
      epsilon: 0.02,
      mutateTimeoutMs: 1_800_000,
      buildTimeoutMs: 600_000,
      buildFixAttempts: 0,
      checkCommand: 'bun check:full',
      mutateFileCommand: 'bun test:mutate:file',
      agent: { model: 'm', extraArgs: [], timeoutMs: 1_800_000 },
      prBranchPrefix: 'mutation-improve',
    }
    const runState = await createRunState(config)

    // runImproveAgent writes the agent's declared spec/plan/test files INTO the
    // worktree so `git add -A` has real content to commit. Without these, a
    // no-op commit would still satisfy "commit exists" but would mask the real
    // regression (the agent's test work silently lost by removeWorktree).
    const runImproveAgent: PipelineDeps['runImproveAgent'] = (
      worktreePath,
    ): Promise<{ value: Result; usage: AgentUsage }> => {
      mkdirSync(path.join(worktreePath, 'docs', 'superpowers', 'specs'), { recursive: true })
      mkdirSync(path.join(worktreePath, 'docs', 'superpowers', 'plans'), { recursive: true })
      writeFileSync(path.join(worktreePath, 'docs', 'superpowers', 'specs', 'x-design.md'), '# spec\n')
      writeFileSync(path.join(worktreePath, 'docs', 'superpowers', 'plans', 'x.md'), '# plan\n')
      writeFileSync(path.join(worktreePath, 'tests', 'foo.test.ts'), "import { test } from 'bun:test'\n")
      return Promise.resolve({ value: improvedResult, usage: emptyUsage() })
    }

    const deps: PipelineDeps = {
      config,
      runState,
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      createWorktree,
      resetWorktree,
      removeWorktree,
      mergeWorktree,
      execGit,
      runBuildCheck: () => Promise.resolve({ passed: true, stdout: '', stderr: '' }),
      measureScore: sequenceMeasure([0.4, 0.97]),
      readBaseline,
      writeBaseline,
      runSelectAgent: () => Promise.resolve({ value: selection, usage: emptyUsage() }),
      runImproveAgent,
      saveRunState: () => Promise.resolve(),
      log: { log: () => undefined },
    }

    const { results } = await runPipeline(deps)
    expect(results[0]?.outcome).toBe('improved')

    // C1 guard #1: a "chore(mutation): ratchet ..." commit must exist on base
    // (repoRoot HEAD). Pre-fix, mergeWorktree merged an empty branch.
    const { stdout: log } = await execGit(repoRoot, ['log', '--oneline'])
    expect(log).toContain('chore(mutation): ratchet src/foo.ts baseline to 0.97')

    // C1 guard #2: the agent's test file must exist on base after merge.
    // Pre-fix, removeWorktree --force discarded the uncommitted work.
    expect(existsSync(path.join(repoRoot, 'tests', 'foo.test.ts'))).toBe(true)

    // C1 guard #3: baseline bump must have propagated to base via the merge.
    const finalBaseline = await readBaseline(repoRoot)
    expect(finalBaseline['src/foo.ts']).toBe(0.97)
  })
})
