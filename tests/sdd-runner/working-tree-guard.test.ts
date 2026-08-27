// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import assert from 'node:assert'

import type { ExecGitFn } from '../../sdd-runner/src/config.js'
import {
  DiffGuardViolationError,
  guardWorkingTree,
  snapshotWorkingTree,
} from '../../sdd-runner/src/working-tree-guard.js'

function execReturning(stdout: string): ExecGitFn {
  return () => Promise.resolve({ stdout, stderr: '' })
}

describe('snapshotWorkingTree', () => {
  it('collects modified and untracked paths from porcelain output', async () => {
    const exec = execReturning(' M src/chat/router.ts\n?? task.md\n')
    const snapshot = await snapshotWorkingTree(exec, '/repo')
    expect([...snapshot]).toEqual(['src/chat/router.ts', 'task.md'])
  })

  it('splits a rename into both sides of the arrow', async () => {
    const exec = execReturning('R  src/old.ts -> src/new.ts\n')
    const snapshot = await snapshotWorkingTree(exec, '/repo')
    expect([...snapshot]).toEqual(['src/old.ts', 'src/new.ts'])
  })

  it('skips blank lines', async () => {
    const exec = execReturning('\n M src/a.ts\n\n')
    const snapshot = await snapshotWorkingTree(exec, '/repo')
    expect([...snapshot]).toEqual(['src/a.ts'])
  })
})

describe('guardWorkingTree', () => {
  it('passes when the tree is unchanged', async () => {
    const before = await snapshotWorkingTree(execReturning(' M src/a.ts\n'), '/repo')
    await expect(guardWorkingTree(execReturning(' M src/a.ts\n'), '/repo', before)).resolves.toBeUndefined()
  })

  it('allows new entries under the change-folder prefix', async () => {
    const before = await snapshotWorkingTree(execReturning(''), '/repo')
    await expect(
      guardWorkingTree(
        execReturning(' M openspec/changes/add-thing/specs/x/spec.md\n?? openspec/changes/add-thing/review.md\n'),
        '/repo',
        before,
      ),
    ).resolves.toBeUndefined()
  })

  it('does not flag pre-existing dirty paths the agent did not touch', async () => {
    const before = await snapshotWorkingTree(execReturning(' M package.json\n?? task.md\n'), '/repo')
    await expect(
      guardWorkingTree(execReturning(' M package.json\n?? task.md\n M src/chat/router.ts\n'), '/repo', before),
    ).rejects.toThrow('agent edited files outside the change folder: src/chat/router.ts')
  })

  it('flags every newly dirtied path outside the change folder', async () => {
    const before = await snapshotWorkingTree(execReturning(''), '/repo')
    let violation: unknown
    try {
      await guardWorkingTree(execReturning(' M src/chat/router.ts\n?? task.md\n'), '/repo', before)
    } catch (error) {
      violation = error
    }
    expect(violation).toBeInstanceOf(DiffGuardViolationError)
    assert(violation instanceof DiffGuardViolationError)
    expect(violation.violations).toEqual(['src/chat/router.ts', 'task.md'])
    expect(violation.message).toBe('agent edited files outside the change folder: src/chat/router.ts, task.md')
  })
})
