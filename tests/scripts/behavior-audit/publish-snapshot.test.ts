// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildCommitMessage,
  formatDateStamp,
  resolveBranchName,
  resolveTagName,
} from '../../../scripts/behavior-audit/publish-snapshot.js'
import type { GitOps, PublishResult } from '../../../scripts/behavior-audit/publish-snapshot.js'
import { runPublish } from '../../../scripts/behavior-audit/publish-snapshot.js'

describe('publish-snapshot helpers', () => {
  afterEach(() => {
    delete process.env['BEHAVIOR_AUDIT_PUBLISH_BRANCH']
    delete process.env['BEHAVIOR_AUDIT_PUBLISH_TAG']
  })

  test('formatDateStamp formats UTC date as YYYY-MM-DD', () => {
    const date = new Date('2026-07-19T03:00:00Z')
    expect(formatDateStamp(date)).toBe('2026-07-19')
  })

  test('formatDateStamp uses UTC across timezones', () => {
    const date = new Date('2026-07-19T23:30:00Z')
    expect(formatDateStamp(date)).toBe('2026-07-19')
  })

  test('resolveBranchName returns audit-output by default', () => {
    delete process.env['BEHAVIOR_AUDIT_PUBLISH_BRANCH']
    expect(resolveBranchName()).toBe('audit-output')
  })

  test('resolveBranchName respects BEHAVIOR_AUDIT_PUBLISH_BRANCH', () => {
    process.env['BEHAVIOR_AUDIT_PUBLISH_BRANCH'] = 'custom-audit-branch'
    expect(resolveBranchName()).toBe('custom-audit-branch')
  })

  test('resolveTagName returns audit-output-latest by default', () => {
    delete process.env['BEHAVIOR_AUDIT_PUBLISH_TAG']
    expect(resolveTagName()).toBe('audit-output-latest')
  })

  test('buildCommitMessage formats date stamp', () => {
    expect(buildCommitMessage('2026-07-19')).toBe('chore(audit): snapshot for 2026-07-19')
  })
})

describe('publishSnapshot flow', () => {
  let tempStories: string
  let tempWorktree: string
  let recordedCommands: ReadonlyArray<readonly string[]>

  beforeEach(() => {
    tempStories = mkdtempSync(join(tmpdir(), 'stories-'))
    tempWorktree = mkdtempSync(join(tmpdir(), 'worktree-'))
    mkdirSync(tempStories, { recursive: true })
    writeFileSync(join(tempStories, 'index.md'), '# Audit\n')
    recordedCommands = []
  })

  afterEach(() => {
    rmSync(tempStories, { recursive: true, force: true })
    rmSync(tempWorktree, { recursive: true, force: true })
  })

  function makeFakeGitOps(): GitOps {
    return {
      run(args: readonly string[]): Promise<void> {
        recordedCommands = [...recordedCommands, args]
        return Promise.resolve()
      },
      branchExists(): Promise<boolean> {
        return Promise.resolve(false)
      },
      checkoutOrphan(branch: string): Promise<void> {
        recordedCommands = [...recordedCommands, ['checkout', '--orphan', branch]]
        return Promise.resolve()
      },
      worktreePath(): Promise<string> {
        return Promise.resolve(tempWorktree)
      },
    }
  }

  test('publishes snapshot to orphan branch on first run', async () => {
    const ops = makeFakeGitOps()
    const result: PublishResult = await runPublish({
      storiesPath: tempStories,
      dateStamp: '2026-07-19',
      gitOps: ops,
      log: { log: () => {}, error: () => {} },
    })
    expect(result.exitCode).toBe(0)
    expect(result.commitMessage).toBe('chore(audit): snapshot for 2026-07-19')
    expect(recordedCommands).toContainEqual(['checkout', '--orphan', 'audit-output'])
    expect(recordedCommands).toContainEqual(['add', 'stories'])
    expect(recordedCommands).toContainEqual(['commit', '-m', 'chore(audit): snapshot for 2026-07-19'])
    expect(recordedCommands).toContainEqual(['tag', '-f', 'audit-output-latest', 'HEAD'])
    const addIdx = recordedCommands.findIndex((c) => c[0] === 'add')
    const commitIdx = recordedCommands.findIndex((c) => c[0] === 'commit')
    const tagIdx = recordedCommands.findIndex((c) => c[0] === 'tag')
    expect(addIdx).toBeGreaterThanOrEqual(0)
    expect(addIdx).toBeLessThan(commitIdx)
    expect(commitIdx).toBeLessThan(tagIdx)
  })

  test('exits 1 when stories path is empty', async () => {
    rmSync(join(tempStories, 'index.md'), { force: true })
    const ops = makeFakeGitOps()
    const result = await runPublish({
      storiesPath: tempStories,
      dateStamp: '2026-07-19',
      gitOps: ops,
      log: { log: () => {}, error: () => {} },
    })
    expect(result.exitCode).toBe(1)
  })

  test('propagates git errors from run and aborts the publish', async () => {
    const run = mock((_args: readonly string[]): Promise<void> => Promise.resolve())
    run.mockResolvedValueOnce(undefined)
    run.mockRejectedValueOnce(new Error('git commit exited 1: identity missing'))
    const failingOps: GitOps = { ...makeFakeGitOps(), run }
    await expect(
      runPublish({
        storiesPath: tempStories,
        dateStamp: '2026-07-19',
        gitOps: failingOps,
        log: { log: () => {}, error: () => {} },
      }),
    ).rejects.toThrow('git commit exited 1: identity missing')
    expect(run.mock.calls).toHaveLength(2)
  })
})
