// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { DEFAULT_CONFIG_PATH, parseCliArgs, resetRunWorktrees, runCli } from '../../mutation-improve/src/cli.js'
import { execGit } from '../../review-loop/src/worktree.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers'

afterEach(cleanupTempDirs)

async function setupRepo(): Promise<{ repoRoot: string; worktreesDir: string }> {
  const repoRoot = makeTempDir('cli-repo-')
  await execGit(repoRoot, ['init'])
  await execGit(repoRoot, ['config', 'user.email', 'test@test.com'])
  await execGit(repoRoot, ['config', 'user.name', 'Test'])
  await execGit(repoRoot, ['checkout', '-b', 'master'])
  writeFileSync(path.join(repoRoot, 'README.md'), 'hello')
  await execGit(repoRoot, ['add', '.'])
  await execGit(repoRoot, ['commit', '-m', 'init'])
  return { repoRoot, worktreesDir: path.join(repoRoot, '.mutation-improve', 'worktrees') }
}

describe('cli parseCliArgs', () => {
  test('parses --config and requires --config (default exists)', () => {
    const args = parseCliArgs(['--config', '/c.json'])
    expect(args.configPath).toBe('/c.json')
    expect(args.count).toBeUndefined()
    expect(args.noPr).toBe(false)
  })

  test('parses --count, --threshold, --base, --no-pr', () => {
    const args = parseCliArgs(['--count', '3', '--threshold=0.9', '--base', 'develop', '--no-pr'])
    expect(args.count).toBe(3)
    expect(args.threshold).toBe(0.9)
    expect(args.base).toBe('develop')
    expect(args.noPr).toBe(true)
  })

  test('rejects non-positive --count', () => {
    expect(() => parseCliArgs(['--count', '0'])).toThrow()
  })

  test('parses --resume-run and --reset-worktree', () => {
    const args = parseCliArgs(['--resume-run', 'r1', '--reset-worktree'])
    expect(args.resumeRunId).toBe('r1')
    expect(args.resetWorktree).toBe(true)
  })

  test('rejects non-numeric --threshold', () => {
    expect(() => parseCliArgs(['--threshold=abc'])).toThrow(/threshold/iu)
    expect(() => parseCliArgs(['--threshold=Infinity'])).toThrow(/threshold/iu)
  })

  test('throws on unknown argument', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow(/Unknown argument/u)
  })

  test('throws when a value-taking flag is missing its value', () => {
    for (const flag of ['--config', '--count', '--base', '--resume-run']) {
      expect(() => parseCliArgs([flag])).toThrow(`Missing value for ${flag}`)
    }
  })

  test('rejects fractional and non-numeric --count', () => {
    expect(() => parseCliArgs(['--count', '3.5'])).toThrow()
    expect(() => parseCliArgs(['--count', 'abc'])).toThrow()
  })

  test('uses the default config path when --config is absent', () => {
    expect(parseCliArgs([]).configPath).toBe(DEFAULT_CONFIG_PATH)
  })
})

describe('resetRunWorktrees', () => {
  test('removes only iteration worktrees and branches matching runId', async () => {
    const { repoRoot, worktreesDir } = await setupRepo()
    const sameRun1 = path.join(worktreesDir, 'r1-iter1')
    const sameRun2 = path.join(worktreesDir, 'r1-iter2')
    const otherRun = path.join(worktreesDir, 'r2-iter1')
    await execGit(repoRoot, ['worktree', 'add', sameRun1, '-b', 'mutation-improve/r1-iter1'])
    await execGit(repoRoot, ['worktree', 'add', sameRun2, '-b', 'mutation-improve/r1-iter2'])
    await execGit(repoRoot, ['worktree', 'add', otherRun, '-b', 'mutation-improve/r2-iter1'])

    await resetRunWorktrees(repoRoot, 'r1', 'mutation-improve')

    expect(existsSync(sameRun1)).toBe(false)
    expect(existsSync(sameRun2)).toBe(false)
    expect(existsSync(otherRun)).toBe(true)
    const { stdout: branches } = await execGit(repoRoot, ['branch', '--list'])
    expect(branches).not.toContain('mutation-improve/r1-iter1')
    expect(branches).not.toContain('mutation-improve/r1-iter2')
    expect(branches).toContain('mutation-improve/r2-iter1')
  })

  test('no-op when no matching worktrees exist', async () => {
    const { repoRoot } = await setupRepo()
    await expect(resetRunWorktrees(repoRoot, 'r1', 'mutation-improve')).resolves.toBeUndefined()
  })
})

describe('runCli integration-branch guard', () => {
  test('fails fast on the base branch before creating run state', async () => {
    const { repoRoot } = await setupRepo()
    const configPath = path.join(repoRoot, 'cfg.json')
    writeFileSync(configPath, JSON.stringify({ repoRoot, workDir: '.mi', agent: { model: 'm' } }))
    await expect(runCli(['--config', configPath])).rejects.toThrow(/integration branch/u)
    expect(existsSync(path.join(repoRoot, '.mi', 'runs'))).toBe(false)
  })

  test('fails fast on a detached HEAD', async () => {
    const { repoRoot } = await setupRepo()
    const { stdout: sha } = await execGit(repoRoot, ['rev-parse', 'HEAD'])
    await execGit(repoRoot, ['checkout', sha.trim()])
    const configPath = path.join(repoRoot, 'cfg.json')
    writeFileSync(configPath, JSON.stringify({ repoRoot, workDir: '.mi', agent: { model: 'm' } }))
    await expect(runCli(['--config', configPath])).rejects.toThrow(/integration branch/u)
    expect(existsSync(path.join(repoRoot, '.mi', 'runs'))).toBe(false)
  })
})
