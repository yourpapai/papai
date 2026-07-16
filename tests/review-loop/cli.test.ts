// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { runBuildCheck } from '../../review-loop/src/build-checker.js'
import { finalizeRun, parseCliArgs, realSpawn, splitLines, type FinalizeDeps } from '../../review-loop/src/cli.js'
import type { ReviewLoopConfig } from '../../review-loop/src/config.js'
import { createRunState, type RunState } from '../../review-loop/src/run-state.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('parseCliArgs', () => {
  test('defaults configPath to review-loop/config.json', () => {
    const args = parseCliArgs(['--plan', '/path/to/plan.md'])
    expect(args.configPath.endsWith('review-loop/config.json')).toBe(true)
    expect(args.repoRoot).toBeUndefined()
  })

  test('parses --config and --plan', () => {
    const args = parseCliArgs(['--config', '/path/to/config.json', '--plan', '/path/to/plan.md'])
    expect(args.configPath).toBe('/path/to/config.json')
    expect(args.planPath).toBe('/path/to/plan.md')
  })

  test('parses --resume-run', () => {
    const args = parseCliArgs([
      '--config',
      '/path/to/config.json',
      '--plan',
      '/path/to/plan.md',
      '--resume-run',
      '2026-07-15T10-30-00-000Z',
    ])
    expect(args.resumeRunId).toBe('2026-07-15T10-30-00-000Z')
  })

  test('throws on missing --plan', () => {
    expect(() => parseCliArgs(['--config', '/path/to/config.json'])).toThrow('Missing required --plan')
  })
})

describe('splitLines', () => {
  const cases: ReadonlyArray<{
    name: string
    pending: string
    chunk: string
    lines: string[]
    remaining: string
  }> = [
    { name: 'single complete line', pending: '', chunk: '{"a":1}\n', lines: ['{"a":1}'], remaining: '' },
    {
      name: 'multiple lines in one chunk',
      pending: '',
      chunk: '{"a":1}\n{"b":2}\n',
      lines: ['{"a":1}', '{"b":2}'],
      remaining: '',
    },
    {
      name: 'line split across chunks: first half',
      pending: '',
      chunk: '{"a":',
      lines: [],
      remaining: '{"a":',
    },
    {
      name: 'line split across chunks: second half',
      pending: '{"a":',
      chunk: '1}\n',
      lines: ['{"a":1}'],
      remaining: '',
    },
    { name: 'skips empty lines', pending: '', chunk: '\n\n{"x":1}\n', lines: ['{"x":1}'], remaining: '' },
    {
      name: 'trailing partial without newline',
      pending: '',
      chunk: '{"a":1}\npartial',
      lines: ['{"a":1}'],
      remaining: 'partial',
    },
    { name: 'empty input', pending: '', chunk: '', lines: [], remaining: '' },
  ]

  for (const c of cases) {
    test(c.name, () => {
      expect(splitLines(c.pending, c.chunk)).toEqual({ lines: c.lines, remaining: c.remaining })
    })
  }
})

async function setupFinalizeFixtures(): Promise<{ config: ReviewLoopConfig; runState: RunState }> {
  const repoRoot = makeTempDir('cli-')
  const config = createReviewLoopConfigFixture(repoRoot)
  const planPath = path.join(repoRoot, 'plan.md')
  writeFileSync(planPath, '# Plan')
  const runState = await createRunState(config, planPath)
  return { config, runState }
}

describe('realSpawn', () => {
  test('surfaces spawn error message when binary cannot be spawned', async () => {
    const result = await realSpawn('this-binary-does-not-exist-12345', [], { cwd: process.cwd() })
    expect(result.exitCode).toBe(1)
    expect(result.stderr.length).toBeGreaterThan(0)
    expect(result.stderr).toContain('this-binary-does-not-exist-12345')
  })
})

describe('finalizeRun', () => {
  test('aborts merge and preserves worktree when final build fails', async () => {
    const { config, runState } = await setupFinalizeFixtures()
    let merged = 0
    let removed = 0
    const deps: FinalizeDeps = {
      exec: () => Promise.resolve({ exitCode: 1, stdout: '', stderr: 'TypeError: broken' }),
      runBuildCheck,
      mergeWorktree: () => {
        merged += 1
        return Promise.resolve()
      },
      removeWorktree: () => {
        removed += 1
        return Promise.resolve()
      },
    }

    await expect(finalizeRun(config, runState, deps)).rejects.toThrow('Final build check failed')
    expect(merged).toBe(0)
    expect(removed).toBe(0)
  })

  test('merges and removes worktree when final build passes', async () => {
    const { config, runState } = await setupFinalizeFixtures()
    let merged = 0
    let removed = 0
    const deps: FinalizeDeps = {
      exec: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      runBuildCheck,
      mergeWorktree: () => {
        merged += 1
        return Promise.resolve()
      },
      removeWorktree: () => {
        removed += 1
        return Promise.resolve()
      },
    }

    await finalizeRun(config, runState, deps)

    expect(merged).toBe(1)
    expect(removed).toBe(1)
  })
})
