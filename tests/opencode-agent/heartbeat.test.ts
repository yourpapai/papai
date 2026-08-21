// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { withHeartbeat } from '../../opencode-agent/src/heartbeat.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import type { ProgressSnapshot } from '../../opencode-agent/src/progress.js'

/**
 * The heartbeat's second reader, which is how the stall watcher gets its tick.
 *
 * The heartbeat already owns the only clock a running turn has, and the stall
 * bound needs exactly that cadence: a question asked while the turn is
 * outstanding, on a timer that already exists. Routing the reader rather than
 * duplicating the timer keeps one clock in the pipeline and keeps the two
 * readers from ever disagreeing about what a turn has done.
 *
 * The log half is unchanged and stays **first and unconditional**: a reader
 * exists to stop the turn, and the line that says the job was not stuck is the
 * one thing the tick already owed a CI reader.
 */

const snapshot = (): ProgressSnapshot => ({ lastAction: 'read (running)', toolCalls: 3, tokens: 900, cost: 0.01 })

interface Line {
  meta: unknown
  message: string
}

const recorder = (): { log: Logger; lines: Line[] } => {
  const lines: Line[] = []
  return {
    lines,
    log: {
      debug: (): void => {},
      info: (meta, message): void => void lines.push({ meta, message }),
      warn: (): void => {},
      error: (): void => {},
    },
  }
}

/** Fires the tick on demand rather than after a real minute. */
const manual = (): {
  schedule: (tick: () => void, everyMs: number) => { cancel: () => void }
  fire: () => void
} => {
  const ticks: Array<() => void> = []
  return {
    fire: (): void => {
      for (const tick of [...ticks]) tick()
    },
    schedule: (tick, _everyMs) => {
      ticks.push(tick)
      return { cancel: (): void => void ticks.splice(ticks.indexOf(tick), 1) }
    },
  }
}

describe('the heartbeat’s second reader', () => {
  test('is called on the same tick, after the log line it may not cost', async () => {
    const { log, lines } = recorder()
    const timer = manual()
    const seen: number[] = []
    const work = new Promise<string>((resolve) => {
      resolve('done')
    })

    const running = withHeartbeat(work, {
      everyMs: 60_000,
      log,
      snapshot,
      schedule: timer.schedule,
      reader: (): void => {
        seen.push(lines.length)
      },
    })
    timer.fire()
    await running

    // The reader ran once, and by then the log line it shares the tick with
    // had already been written — first and unconditional.
    expect(seen).toEqual([1])
    expect(lines).toHaveLength(1)
  })

  test('runs on every tick, not only the first, while the work is outstanding', async () => {
    const { log } = recorder()
    const timer = manual()
    const calls: number[] = []
    let settle: (value: string) => void = (): void => {}
    const work = new Promise<string>((resolve) => {
      settle = resolve
    })

    const running = withHeartbeat(work, {
      everyMs: 60_000,
      log,
      snapshot,
      schedule: timer.schedule,
      reader: (): void => void calls.push(calls.length),
    })
    timer.fire()
    timer.fire()
    timer.fire()
    settle('done')
    await running

    expect(calls).toHaveLength(3)
  })

  test('is not called once the work has finished', async () => {
    const { log } = recorder()
    const timer = manual()
    const calls: number[] = []

    await withHeartbeat(Promise.resolve('done'), {
      everyMs: 60_000,
      log,
      snapshot,
      schedule: timer.schedule,
      reader: (): void => void calls.push(calls.length),
    })
    timer.fire()

    expect(calls).toHaveLength(0)
  })

  test('a heartbeat with no reader wired behaves exactly as it did before one existed', async () => {
    const { log, lines } = recorder()
    const timer = manual()
    let settle: (value: string) => void = (): void => {}
    const work = new Promise<string>((resolve) => {
      settle = resolve
    })

    const running = withHeartbeat(work, { everyMs: 60_000, log, snapshot, schedule: timer.schedule })
    timer.fire()
    settle('done')
    await running

    expect(lines).toHaveLength(1)
    expect(lines[0]?.message).toContain('not stuck')
  })
})
