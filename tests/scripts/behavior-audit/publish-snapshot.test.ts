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
import { RealGitOps, runPublish } from '../../../scripts/behavior-audit/publish-snapshot.js'

const GIT_SPAWN_ENV: NodeJS.Dict<string> = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Audit Test',
  GIT_AUTHOR_EMAIL: 'audit-test@example.com',
  GIT_COMMITTER_NAME: 'Audit Test',
  GIT_COMMITTER_EMAIL: 'audit-test@example.com',
}

async function runRealGit(args: readonly string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    env: GIT_SPAWN_ENV,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${code}: ${stderr.trim()}`)
  }
}

async function runRealGitCapture(args: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    env: GIT_SPAWN_ENV,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${code}: ${stderr.trim()}`)
  }
  return stdout
}

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
    expect(recordedCommands).toContainEqual(['rm', '-rf', '.'])
    expect(recordedCommands).toContainEqual(['add', 'stories'])
    expect(recordedCommands).toContainEqual(['commit', '-m', 'chore(audit): snapshot for 2026-07-19'])
    expect(recordedCommands).toContainEqual(['tag', '-f', 'audit-output-latest', 'HEAD'])
    const orphanIdx = recordedCommands.findIndex((c) => c.join(' ') === 'checkout --orphan audit-output')
    const rmIdx = recordedCommands.findIndex((c) => c.join(' ') === 'rm -rf .')
    const addIdx = recordedCommands.findIndex((c) => c[0] === 'add')
    const commitIdx = recordedCommands.findIndex((c) => c[0] === 'commit')
    const tagIdx = recordedCommands.findIndex((c) => c[0] === 'tag')
    expect(orphanIdx).toBeGreaterThanOrEqual(0)
    expect(rmIdx).toBeGreaterThan(orphanIdx)
    expect(addIdx).toBeGreaterThan(rmIdx)
    expect(addIdx).toBeLessThan(commitIdx)
    expect(commitIdx).toBeLessThan(tagIdx)
  })

  test('recreates orphan branch and clears inherited index even when branch already exists', async () => {
    const ops: GitOps = {
      ...makeFakeGitOps(),
    }
    const result: PublishResult = await runPublish({
      storiesPath: tempStories,
      dateStamp: '2026-07-19',
      gitOps: ops,
      log: { log: () => {}, error: () => {} },
    })
    expect(result.exitCode).toBe(0)
    expect(recordedCommands).toContainEqual(['checkout', '--orphan', 'audit-output'])
    expect(recordedCommands).toContainEqual(['rm', '-rf', '.'])
    const orphanIdx = recordedCommands.findIndex((c) => c.join(' ') === 'checkout --orphan audit-output')
    const rmIdx = recordedCommands.findIndex((c) => c.join(' ') === 'rm -rf .')
    expect(orphanIdx).toBeGreaterThanOrEqual(0)
    expect(rmIdx).toBeGreaterThan(orphanIdx)
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

  test('drops the existing branch ref before the orphan checkout', async () => {
    const ops = makeFakeGitOps()
    await runPublish({
      storiesPath: tempStories,
      dateStamp: '2026-07-19',
      gitOps: ops,
      log: { log: () => {}, error: () => {} },
    })
    const deleteIdx = recordedCommands.findIndex((c) => c.join(' ') === 'branch -D audit-output')
    const orphanIdx = recordedCommands.findIndex((c) => c.join(' ') === 'checkout --orphan audit-output')
    expect(deleteIdx).toBeGreaterThanOrEqual(0)
    expect(orphanIdx).toBeGreaterThan(deleteIdx)
  })
})

describe('publishSnapshot real-git integration', () => {
  let repo: string
  let stories: string

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'publish-real-'))
    stories = mkdtempSync(join(tmpdir(), 'publish-stories-'))
    await runRealGit(['init', '-q', '-b', 'main'], repo)
    await runRealGit(['config', 'user.email', 'audit-test@example.com'], repo)
    await runRealGit(['config', 'user.name', 'Audit Test'], repo)
    await runRealGit(['config', 'commit.gpgsign', 'false'], repo)
    writeFileSync(join(repo, 'README.md'), 'init\n')
    await runRealGit(['add', 'README.md'], repo)
    await runRealGit(['commit', '-m', 'init', '-q'], repo)

    writeFileSync(join(stories, 'index.md'), '# Audit v1\n')
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
    rmSync(stories, { recursive: true, force: true })
  })

  test('second runPublish succeeds when audit-output ref already exists locally', async () => {
    const ops = new RealGitOps(repo)

    const first = await runPublish({
      storiesPath: stories,
      dateStamp: '2026-07-19',
      gitOps: ops,
      log: { log: () => {}, error: () => {} },
    })
    expect(first.exitCode).toBe(0)
    expect(first.commitMessage).toBe('chore(audit): snapshot for 2026-07-19')

    // Mirror CI: each nightly starts on the default branch with the previous
    // audit-output ref fetched into refs/heads. After the first runPublish
    // HEAD is on audit-output; flip back to main so `branch -D` is allowed
    // and the orphan checkout can recreate the ref.
    await runRealGit(['checkout', 'main'], repo)
    await runRealGit(['rev-parse', '--verify', '--quiet', 'refs/heads/audit-output'], repo)

    writeFileSync(join(stories, 'index.md'), '# Audit v2\n')
    const second = await runPublish({
      storiesPath: stories,
      dateStamp: '2026-07-20',
      gitOps: ops,
      log: { log: () => {}, error: () => {} },
    })
    expect(second.exitCode).toBe(0)
    expect(second.commitMessage).toBe('chore(audit): snapshot for 2026-07-20')

    // The latest commit on audit-output must reflect the second snapshot.
    const committed = await runRealGitCapture(['show', 'audit-output:stories/index.md'], repo)
    expect(committed).toBe('# Audit v2\n')
  })
})
