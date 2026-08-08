// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { reportMergeDiff } from '../../mutation-improve/src/merge-stats.js'
import type { DiffStats } from '../../review-loop/src/diff-stats.js'

describe('reportMergeDiff', () => {
  test('measures the diff since beforeSha and reports it via log.diff', async () => {
    const reported: Array<{ label: string; diff: DiffStats }> = []
    const execGit = (): Promise<{ stdout: string; stderr: string }> =>
      Promise.resolve({ stdout: '301\t12\ttests/x.test.ts\n', stderr: '' })
    await reportMergeDiff(
      {
        execGit,
        config: { repoRoot: '/repo' },
        log: {
          log: (): void => undefined,
          diff: (label: string, diff: DiffStats): void => {
            reported.push({ label, diff })
          },
        },
      },
      1,
      'abc123',
    )
    expect(reported).toEqual([{ label: 'iter-1', diff: { added: 301, removed: 12 } }])
  })

  test('falls back to log.log when the diff measurement throws', async () => {
    const logs: string[] = []
    const reported: unknown[] = []
    const execGit = (): Promise<{ stdout: string; stderr: string }> => Promise.reject(new Error('git blew up'))
    await reportMergeDiff(
      {
        execGit,
        config: { repoRoot: '/repo' },
        log: {
          log: (msg: string): void => {
            logs.push(msg)
          },
          diff: (): void => {
            reported.push(1)
          },
        },
      },
      1,
      'abc123',
    )
    expect(reported).toEqual([])
    expect(logs).toEqual(['[stats] merge diff unavailable: git blew up'])
  })
})
