// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import { runInspector } from '../../review-loop/src/issue-inspector.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'
import { execGit } from '../../review-loop/src/worktree.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir, silentReporter } from './test-helpers.js'

afterEach(cleanupTempDirs)

const issue: ReviewerIssue = {
  title: 'x',
  severity: 'low',
  summary: 's',
  whyItMatters: 'w',
  evidence: 'e',
  file: 'src/q.ts',
  lineStart: 1,
  lineEnd: 2,
  suggestedFix: 'f',
  confidence: 0.9,
}

function mockSpawnInspect(addresses: boolean): SpawnFn {
  return (_cmd, args, opts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/JSON to:\s*(\S+)/u)?.[1]
    if (prompt.includes('You are an inspector') && outputPath !== undefined) {
      writeFileSync(path.join(opts.cwd, outputPath), JSON.stringify({ addresses, reasoning: 'mock', confidence: 0.8 }))
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
  }
}

async function setupRepo(repoPath: string): Promise<void> {
  mkdirSync(repoPath, { recursive: true })
  await execGit(repoPath, ['init'])
  await execGit(repoPath, ['config', 'user.email', 't@t.com'])
  await execGit(repoPath, ['config', 'user.name', 'T'])
  writeFileSync(path.join(repoPath, 'README.md'), 'hi')
  await execGit(repoPath, ['add', '.'])
  await execGit(repoPath, ['commit', '-m', 'init'])
}

describe('runInspector', () => {
  test('returns InspectorResult with addresses=true when agent accepts', async () => {
    const repoRoot = makeTempDir('inspector-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupRepo(runState.worktreePath)
    const { logger } = createCapturingTraceLogger()
    const result = await runInspector(
      {
        spawn: mockSpawnInspect(true),
        cwd: runState.worktreePath,
        issue,
        baselineSha: 'HEAD',
        outputPath: runState.inspectPath,
        logPath: runState.logPath,
        reporter: silentReporter(),
        model: 'm',
        extraArgs: [],
      },
      1,
      'rec-1',
      logger,
    )
    expect(result.addresses).toBe(true)
    expect(result.usage).toBeDefined()
  })
})
