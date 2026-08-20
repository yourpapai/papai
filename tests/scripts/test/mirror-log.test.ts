// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MIRROR_POLL_MS, mirrorLogWhile } from '../../../scripts/test/mirror-log.js'
import type { MirrorDeps } from '../../../scripts/test/mirror-log.js'

/**
 * A tail harness with a manually pumped clock: nothing advances until a test
 * resolves the sleep the tailer is parked in, so poll ordering is deterministic.
 */
const tailHarness = (): {
  deps: MirrorDeps
  written: string[]
  sleepCalls: number[]
  append: (chunk: string) => void
  vanish: () => void
  poll: () => Promise<void>
  exit: () => void
  exited: Promise<void>
} => {
  let text = ''
  let missing = false
  const written: string[] = []
  const sleepCalls: number[] = []
  const resolvers: Array<() => void> = []
  let exitResolve: () => void = () => {}
  const exited = new Promise<void>((resolve) => {
    exitResolve = resolve
  })

  const deps: MirrorDeps = {
    size: (): number | null => (missing ? null : text.length),
    read: (_path, start, end): string => text.slice(start, end),
    write: (chunk: string): void => {
      written.push(chunk)
    },
    sleep: (ms: number): Promise<void> => {
      sleepCalls.push(ms)
      return new Promise<void>((resolve) => {
        resolvers.push(resolve)
      })
    },
  }

  return {
    deps,
    written,
    sleepCalls,
    append: (chunk: string): void => {
      text += chunk
    },
    vanish: (): void => {
      missing = true
    },
    poll: async (): Promise<void> => {
      resolvers.shift()?.()
      await Promise.resolve()
      await Promise.resolve()
    },
    exit: (): void => {
      exitResolve()
    },
    exited,
  }
}

describe('mirrorLogWhile', () => {
  test('mirrors only the bytes that grew since the previous poll', async () => {
    const h = tailHarness()
    const tail = mirrorLogWhile('/tmp/log', h.exited, h.deps)

    h.append('first ')
    await h.poll()
    h.append('second ')
    await h.poll()
    h.exit()
    await tail

    expect(h.written).toEqual(['first ', 'second '])
  })

  test('polls on the ~250 ms interval', async () => {
    const h = tailHarness()
    const tail = mirrorLogWhile('/tmp/log', h.exited, h.deps)

    await h.poll()
    await h.poll()
    h.exit()
    await tail

    expect(h.sleepCalls.length).toBeGreaterThanOrEqual(2)
    for (const ms of h.sleepCalls) expect(ms).toBe(MIRROR_POLL_MS)
  })

  test('drains one last time when the child exits', async () => {
    const h = tailHarness()
    const tail = mirrorLogWhile('/tmp/log', h.exited, h.deps)

    await h.poll()
    h.append('late bytes ')
    h.exit()
    await tail

    expect(h.written).toEqual(['late bytes '])
  })

  test('mirrors nothing more once the child has exited', async () => {
    const h = tailHarness()
    const tail = mirrorLogWhile('/tmp/log', h.exited, h.deps)

    h.append('a')
    await h.poll()
    h.exit()
    await tail

    h.append('after exit')
    await Promise.resolve()
    await Promise.resolve()

    expect(h.written).toEqual(['a'])
  })

  test('a vanished log file is skipped without throwing', async () => {
    const h = tailHarness()
    const tail = mirrorLogWhile('/tmp/log', h.exited, h.deps)

    h.append('gone ')
    h.vanish()
    await h.poll()
    h.exit()
    await tail

    expect(h.written).toEqual([])
  })
})
