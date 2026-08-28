// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { Git } from '../../opencode-agent/src/git.js'
import { fakeGit } from './fake-git.js'

/**
 * Type-level: this annotation compiles only while the double implements every
 * `Git` member. The same anchor lives in the module (`const git: Git`), so an
 * interface change the fake misses is a type error there before any test runs.
 */
const fullInterface: Git = fakeGit().git

describe('fakeGit', () => {
  test('implements the full Git interface with no member missing', () => {
    expect(Object.keys(fullInterface).sort()).toEqual([
      'abortMerge',
      'changedSince',
      'commitAll',
      'completeMerge',
      'defaultBranch',
      'deleteRemoteBranch',
      'diffSince',
      'ensureBranch',
      'headSha',
      'mergeBase',
      'push',
      'reconcile',
      'resetBranchToBase',
      'revertPaths',
      'salvageAll',
    ])
  })

  test('a scripted rejection rejects; a scripted return resolves', async () => {
    const { git } = fakeGit({
      push: new Error('no upstream'),
      headSha: 'abc123',
      commitAll: { kind: 'committed', totals: { files: 1, lines: 4 }, dropped: [] },
    })

    await expect(git.push('agent/issue-1')).rejects.toThrow('no upstream')
    await expect(git.headSha()).resolves.toBe('abc123')
    await expect(git.commitAll('msg')).resolves.toEqual({
      kind: 'committed',
      totals: { files: 1, lines: 4 },
      dropped: [],
    })
  })

  test('unscripted calls resolve a clean-success default, not undefined behaviour', async () => {
    const { git } = fakeGit()

    await expect(git.ensureBranch('agent/issue-1', 'main')).resolves.toBeUndefined()
    await expect(git.push('agent/issue-1')).resolves.toBeUndefined()
    await expect(git.commitAll('msg')).resolves.toEqual({ kind: 'clean' })
    await expect(git.salvageAll('msg')).resolves.toEqual({ kind: 'clean' })
    await expect(git.mergeBase('main')).resolves.toEqual({ kind: 'up-to-date' })
    await expect(git.defaultBranch()).resolves.toBeNull()
    await expect(git.headSha()).resolves.toBe('head-sha')
    await expect(git.changedSince('sha')).resolves.toEqual([])
    await expect(git.diffSince('sha', ['a.ts'])).resolves.toBe('')
  })

  test('records every call as method:arg lines', async () => {
    const { git, calls } = fakeGit()

    await git.ensureBranch('agent/issue-1', 'main')
    await git.deleteRemoteBranch('agent/issue-1')
    await git.commitAll('fix: subject\n\nbody')
    await git.salvageAll('salvage subject\nbody')
    await git.reconcile('agent/issue-1')
    await git.push('agent/issue-1')
    await git.push('agent/issue-1', { noVerify: true })
    await git.changedSince('head-sha')
    await git.diffSince('moved', ['src/a.ts', 'src/b.ts'])
    await git.revertPaths('moved', ['.github/workflows/ci.yml', 'run.pid'])
    await git.mergeBase('main')
    await git.completeMerge('merge subject\nbody')
    await git.abortMerge()
    await git.resetBranchToBase('agent/issue-1', 'main')

    expect(calls).toEqual([
      'ensureBranch:agent/issue-1:main',
      'deleteRemoteBranch:agent/issue-1',
      'commit:fix: subject',
      'salvage:salvage subject',
      'reconcile:agent/issue-1',
      'push:agent/issue-1',
      'push:agent/issue-1:no-verify',
      'changedSince:head-sha',
      'diffSince:moved:src/a.ts,src/b.ts',
      'revertPaths:moved:.github/workflows/ci.yml,run.pid',
      'mergeBase:main',
      'completeMerge:merge subject',
      'abortMerge',
      'resetBranchToBase:agent/issue-1:main',
    ])
    // Read-only value probes stay out of the log — the `io.gitCalls` idiom this
    // double mirrors deliberately leaves `defaultBranch`/`headSha` unlogged so
    // a flow's call list reads as the operations it performed, not the values
    // it polled. Pinned here because the orchestrator suite's exact-array
    // assertions depend on it.
    await git.defaultBranch()
    await git.headSha()
    expect(calls).toHaveLength(14)
  })

  test('a scripted queue serves one outcome per call, then falls back to the default', async () => {
    const { git } = fakeGit({ push: [new Error('flaky')] })

    await expect(git.push('agent/issue-1')).rejects.toThrow('flaky')
    await expect(git.push('agent/issue-1')).resolves.toBeUndefined()
    await expect(git.push('agent/issue-1')).resolves.toBeUndefined()
  })

  test('script entries can be functions read per call, so a test can move an outcome after construction', async () => {
    const answer = { headSha: 'before' }
    const { git, script } = fakeGit({ headSha: () => answer.headSha })

    await expect(git.headSha()).resolves.toBe('before')
    answer.headSha = 'after'
    await expect(git.headSha()).resolves.toBe('after')

    script.push = new Error('no upstream')
    await expect(git.push('agent/issue-1')).rejects.toThrow('no upstream')
  })
})
