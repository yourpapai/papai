// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { FIX_PUBLISHED_MARKER, publishFix } from '../../review-loop/src/publish-fix.js'
import type { MergeResult } from '../../review-loop/src/worktree.js'

const recorder = (): { events: string[]; log: { event: (message: string) => void } } => {
  const events: string[] = []
  return {
    events,
    log: {
      event: (message): void => {
        events.push(message)
      },
    },
  }
}

describe('publishFix', () => {
  test('merges the loop branch into the checkout and announces it on stdout', async () => {
    const { events, log } = recorder()
    const merged: Array<[string, string]> = []

    await publishFix({
      repoRoot: '/repo',
      branch: 'review-loop/run-1',
      log,
      merge: (repoRoot, branch): Promise<MergeResult> => {
        merged.push([repoRoot, branch])
        return Promise.resolve({ ok: true })
      },
    })

    expect(merged).toEqual([['/repo', 'review-loop/run-1']])
    // The marker is the whole contract with the caller that runs this loop in
    // CI: it is the moment a fix becomes something that can be pushed.
    expect(events[0]?.startsWith(FIX_PUBLISHED_MARKER)).toBe(true)
  })

  test('a conflict is reported, not thrown: the run continues and the final merge decides', async () => {
    const { events, log } = recorder()

    await publishFix({
      repoRoot: '/repo',
      branch: 'review-loop/run-1',
      log,
      merge: (): Promise<MergeResult> => Promise.resolve({ ok: false, conflictFiles: ['src/a.ts'] }),
    })

    expect(events[0]).toContain('src/a.ts')
    expect(events.some((event) => event.startsWith(FIX_PUBLISHED_MARKER))).toBe(false)
  })

  test('a merge that throws is reported, not thrown', async () => {
    const { events, log } = recorder()

    await publishFix({
      repoRoot: '/repo',
      branch: 'review-loop/run-1',
      log,
      merge: (): Promise<MergeResult> => Promise.reject(new Error('index.lock exists')),
    })

    expect(events[0]).toContain('index.lock exists')
  })
})
