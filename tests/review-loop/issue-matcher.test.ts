// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import type { LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import { matchIssues } from '../../review-loop/src/issue-matcher.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import {
  claudeRecordingSpawn,
  claudeRunContext,
  claudeScratchResponder,
  cleanupTempDirs,
  makeTempDir,
  silentReporter,
} from './test-helpers.js'

afterEach(cleanupTempDirs)

const existingIssue: ReviewerIssue = {
  title: 'Race condition in queue flush',
  kind: 'defect',
  severity: 'high',
  summary: 'Two concurrent messages bypass the lock.',
  whyItMatters: 'Stale replies.',
  evidence: 'queue.ts:84',
  file: 'src/queue.ts',
  lineStart: 84,
  lineEnd: 107,
  suggestedFix: 'Lock earlier.',
  confidence: 0.9,
}

const existingRecord: LedgerIssueRecord = {
  id: 'existing-001',
  issue: existingIssue,
  status: 'fixed_pending_review',
  firstSeenRound: 1,
  latestSeenRound: 1,
  fixAttempts: 1,
  verifierDecision: null,
}

const newIssue: ReviewerIssue = {
  ...existingIssue,
  title: 'Race condition when flushing the queue',
  summary: 'Concurrent flush calls interleave without locking.',
}

function createMockSpawn(outputPath: string, data: unknown): SpawnFn {
  return (
    _command: string,
    _args: readonly string[],
    opts: { cwd: string },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
    writeFileSync(path.join(opts.cwd, '.review-loop', path.basename(outputPath)), JSON.stringify(data))
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
}

function createCapturingSpawn(outputPath: string): { spawn: SpawnFn; lastPrompt: () => string } {
  let captured = ''
  const spawn: SpawnFn = (
    _command: string,
    args: readonly string[],
    opts: { cwd: string },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
    captured = args[args.length - 1] ?? ''
    writeFileSync(path.join(opts.cwd, '.review-loop', path.basename(outputPath)), JSON.stringify({ matches: [] }))
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  return { spawn, lastPrompt: () => captured }
}

describe('issue-matcher', () => {
  test('returns null matches when ledger is empty', async () => {
    const dir = makeTempDir('matcher-')
    const result = await matchIssues({
      spawn: (): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
        Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      newIssues: [newIssue],
      existingRecords: [],
      outputPath: path.join(dir, 'matches.json'),
      logPath: path.join(dir, 'log.txt'),
      cwd: dir,
      model: 'test-model',
      extraArgs: [],
      reporter: silentReporter(),
    })

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.existingId).toBeNull()
  })

  test('returns LLM-provided matches when ledger has entries', async () => {
    const dir = makeTempDir('matcher-')
    const outputPath = path.join(dir, 'matches.json')
    const matchData = {
      matches: [{ newIssueIndex: 0, existingId: 'existing-001' }],
    }

    const result = await matchIssues({
      spawn: createMockSpawn(outputPath, matchData),
      newIssues: [newIssue],
      existingRecords: [existingRecord],
      outputPath,
      logPath: path.join(dir, 'log.txt'),
      cwd: dir,
      model: 'test-model',
      extraArgs: [],
      reporter: silentReporter(),
    })

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.existingId).toBe('existing-001')
  })

  test('short-circuits without invoking matcher when there are no new issues', async () => {
    const dir = makeTempDir('matcher-')
    const spawn = mock((): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
      Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    )

    const result = await matchIssues({
      spawn,
      newIssues: [],
      existingRecords: [existingRecord],
      outputPath: path.join(dir, 'matches.json'),
      logPath: path.join(dir, 'log.txt'),
      cwd: dir,
      model: 'test-model',
      extraArgs: [],
      reporter: silentReporter(),
    })

    expect(result.matches).toEqual([])
    expect(spawn).not.toHaveBeenCalled()
  })

  test('matcher prompt keeps sentinel and inlines schema', async () => {
    const dir = makeTempDir('matcher-')
    const outputPath = path.join(dir, 'matches.json')
    const { spawn, lastPrompt } = createCapturingSpawn(outputPath)

    await matchIssues({
      spawn,
      newIssues: [newIssue],
      existingRecords: [existingRecord],
      outputPath,
      logPath: path.join(dir, 'log.txt'),
      cwd: dir,
      model: 'test-model',
      extraArgs: [],
      reporter: silentReporter(),
    })

    const prompt = lastPrompt()
    expect(prompt).toContain('Match newly found')
    expect(prompt).toContain('underlying problem')
    expect(prompt).toContain('"matches"')
  })

  test('matcher prompt contains absolute scratch path resolved against cwd (not a relative one)', async () => {
    const dir = makeTempDir('matcher-')
    const nestedCwd = path.join(dir, 'worktree')
    const outputPath = path.join(dir, 'matches.json')
    mkdirSync(nestedCwd, { recursive: true })
    const { spawn, lastPrompt } = createCapturingSpawn(outputPath)

    await matchIssues({
      spawn,
      newIssues: [newIssue],
      existingRecords: [existingRecord],
      outputPath,
      logPath: path.join(dir, 'log.txt'),
      cwd: nestedCwd,
      model: 'test-model',
      extraArgs: [],
      reporter: silentReporter(),
    })

    const prompt = lastPrompt()
    const expectedAbsolute = path.join(nestedCwd, '.review-loop', 'matches.json')
    expect(prompt).toContain(expectedAbsolute)
    expect(path.isAbsolute(expectedAbsolute)).toBe(true)
    expect(prompt).not.toContain(`\n.review-loop/matches.json\n`)
  })
})

describe('issue-matcher backend threading', () => {
  test('passes the resolved backend and claude context into the matcher spawn', async () => {
    const dir = makeTempDir('matcher-claude-')
    const outputPath = path.join(dir, 'matches.json')
    const { spawn, commands } = claudeRecordingSpawn(
      claudeScratchResponder(() => ({ matches: [{ newIssueIndex: 0, existingId: 'existing-001' }] })),
    )

    const result = await matchIssues({
      spawn,
      newIssues: [newIssue],
      existingRecords: [existingRecord],
      outputPath,
      logPath: path.join(dir, 'log.txt'),
      cwd: dir,
      model: 'test-model',
      extraArgs: [],
      reporter: silentReporter(),
      backend: 'claude',
      claude: claudeRunContext(),
    })

    expect(result.matches[0]?.existingId).toBe('existing-001')
    expect(commands[0]).toBe('claude')
  })

  test('the matcher effort rides the spawn as --effort after --model (D4, D6)', async () => {
    const dir = makeTempDir('matcher-effort-')
    const outputPath = path.join(dir, 'matches.json')
    const { spawn, args } = claudeRecordingSpawn(
      claudeScratchResponder(() => ({ matches: [{ newIssueIndex: 0, existingId: 'existing-001' }] })),
    )

    // The deps are deliberately built unannotated — a structural superset —
    // so this assertion states the spawn contract directly rather than
    // through the deps interface.
    const deps = {
      spawn,
      newIssues: [newIssue],
      existingRecords: [existingRecord],
      outputPath,
      logPath: path.join(dir, 'log.txt'),
      cwd: dir,
      model: 'test-model',
      extraArgs: [],
      reporter: silentReporter(),
      backend: 'claude' as const,
      claude: claudeRunContext(),
      effort: 'low',
    }

    const result = await matchIssues(deps)

    expect(result.matches[0]?.existingId).toBe('existing-001')
    const argv = args[0]!
    const model = argv.indexOf('--model')
    expect(argv.slice(model + 2, model + 4)).toEqual(['--effort', 'low'])
  })
})
