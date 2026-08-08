// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { describeActivity } from '../../opencode-agent/src/activity.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import { createProgressTracker, followEvents, withHeartbeat } from '../../opencode-agent/src/progress.js'
import type { ProgressSnapshot } from '../../opencode-agent/src/progress.js'

const SESSION = 'ses_02414f224ffejPyZrczmjjX3YF'
const OTHER = 'ses_somebody_else'

/**
 * Recorded from a live `opencode serve` 1.18.7, driven through this pipeline's
 * own generated config against a stub provider. Trimmed only where noted — the
 * shapes, field names and ordering are as observed, not invented.
 */
const TOOL_RUNNING = {
  id: 'evt_fdbeb1392001RDxY0S6A2GTZ6l',
  type: 'message.part.updated',
  properties: {
    sessionID: SESSION,
    part: {
      type: 'tool',
      tool: 'read',
      callID: 'call_1',
      state: {
        status: 'running',
        input: { filePath: '/home/user/papai/package.json' },
        time: { start: 1786101044113 },
      },
      id: 'prt_fdbeb1386001mFXY8OuVRslEEl',
      sessionID: SESSION,
      messageID: 'msg_fdbeb107d001oVo9AQ5GFCdn92',
    },
  },
} as const

const TOOL_COMPLETED = {
  id: 'evt_fdbeb13b7001pjRa0rm5S7G4qs',
  type: 'message.part.updated',
  properties: {
    sessionID: SESSION,
    part: {
      type: 'tool',
      tool: 'read',
      callID: 'call_1',
      state: {
        status: 'completed',
        input: { filePath: '/home/user/papai/package.json' },
        // The real one is the entire file. This is the field the log must never
        // carry, so the fixture keeps enough of it to prove that.
        output: '<path>/home/user/papai/package.json</path>\n<content>\n1: {\n2:   "name": "papai",\n',
      },
      id: 'prt_fdbeb1386001mFXY8OuVRslEEl',
      sessionID: SESSION,
      messageID: 'msg_fdbeb107d001oVo9AQ5GFCdn92',
    },
  },
} as const

const TOOL_PENDING = {
  type: 'message.part.updated',
  properties: {
    sessionID: SESSION,
    part: { type: 'tool', tool: 'read', callID: 'call_1', state: { status: 'pending', input: {}, raw: '' } },
  },
} as const

const STEP_FINISH = {
  id: 'evt_fdbeb147f001X9e1p2ojeC0vh4',
  type: 'message.part.updated',
  properties: {
    sessionID: SESSION,
    part: {
      id: 'prt_fdbeb147f0016JArYtDaaUlGt9',
      reason: 'stop',
      messageID: 'msg_fdbeb1408001seBEufpttIaISx',
      sessionID: SESSION,
      type: 'step-finish',
      tokens: { input: 1200, output: 340, reasoning: 12, cache: { write: 0, read: 0 } },
      cost: 0.004,
    },
  },
} as const

const BUSY = {
  id: 'evt_fdbeb1078001i8MxIglPHAA1mS',
  type: 'session.status',
  properties: { sessionID: SESSION, status: { type: 'busy' } },
} as const

const IDLE = {
  type: 'session.status',
  properties: { sessionID: SESSION, status: { type: 'idle' } },
} as const

/**
 * Recorded by pointing a stub provider at 429 twice: OpenCode retries the call
 * itself, and says so. `message` is the provider's own error text — the one
 * field of this event the decoder deliberately drops.
 */
const RETRY = {
  id: 'evt_fdc068971001Bla9VvtK5laCtU',
  type: 'session.status',
  properties: {
    sessionID: SESSION,
    status: { type: 'retry', attempt: 1, message: 'slow down', next: 1786102845761 },
  },
} as const

const TEXT_PART = {
  type: 'message.part.updated',
  properties: {
    sessionID: SESSION,
    part: {
      id: 'prt_fdbeb145b0018ZdMlmghAr8j1D',
      type: 'text',
      text: 'I looked at it and here is the answer.',
      sessionID: SESSION,
    },
  },
} as const

/** Not in the SDK's generated `Event` union, but the running server emits it. */
const PART_DELTA = {
  type: 'message.part.delta',
  properties: { sessionID: SESSION, partID: 'prt_1', field: 'text', delta: 'I looked at it' },
} as const

const PLUGIN_ADDED = { type: 'plugin.added', properties: { id: 'core/config-reference' } } as const

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

/** Serves one event, then fails — a server going away mid-run. */
const dyingStream = (first: unknown): AsyncIterable<unknown> => ({
  [Symbol.asyncIterator]: (): AsyncIterator<unknown> => {
    let served = false
    return {
      next: (): Promise<IteratorResult<unknown>> => {
        if (served) return Promise.reject(new Error('socket closed'))
        served = true
        return Promise.resolve({ value: first, done: false })
      },
    }
  },
})

/** Never yields and never ends, until asked to return. */
const endlessStream = (): AsyncIterable<unknown> => ({
  [Symbol.asyncIterator]: (): AsyncIterator<unknown> => {
    let settle: ((result: IteratorResult<unknown>) => void) | null = null
    return {
      next: (): Promise<IteratorResult<unknown>> =>
        new Promise((resolve) => {
          settle = resolve
        }),
      return: (): Promise<IteratorResult<unknown>> => {
        settle?.({ value: undefined, done: true })
        return Promise.resolve({ value: undefined, done: true })
      },
    }
  },
})

const streamOf = (events: readonly unknown[]): AsyncIterable<unknown> => {
  const queue = [...events]
  return {
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<unknown>> => {
        if (queue.length === 0) return Promise.resolve({ value: undefined, done: true })
        return Promise.resolve({ value: queue.shift(), done: false })
      },
    }),
  }
}

const elapsedOf = (line: Line | undefined): number => {
  const meta = line?.meta
  if (typeof meta !== 'object' || meta === null) return Number.NaN
  const elapsed = (meta as { elapsedMs?: unknown }).elapsedMs
  return typeof elapsed === 'number' ? elapsed : Number.NaN
}

/** Polls rather than sleeping a fixed time, which flakes under worker load. */
const until = async (ready: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 500 && !ready(); attempt += 1) await Bun.sleep(2)
}

/** Keeps the "did it decode?" narrowing out of the test bodies. */
const metaOf = (event: unknown, session = SESSION): Record<string, string | number> =>
  describeActivity(event, session)?.meta ?? {}

const messageOf = (event: unknown, session = SESSION): string => describeActivity(event, session)?.message ?? '(none)'

describe('describeActivity', () => {
  test('names a tool the model started, and its status', () => {
    expect(metaOf(TOOL_RUNNING)).toEqual({ tool: 'read', status: 'running', call: 'call_1' })
    expect(messageOf(TOOL_RUNNING)).toBe('Model tool call')
  })

  test('never carries the tool input, whatever the tool was asked to do', () => {
    // `input` is the bash command, or the whole new contents of a file being
    // written. A CI log on a public repository is world-readable and is not
    // covered by the outbound redaction that guards issue comments.
    expect(JSON.stringify(metaOf(TOOL_RUNNING))).not.toContain('package.json')
  })

  test('never carries the tool output, which is an entire file', () => {
    expect(JSON.stringify(metaOf(TOOL_COMPLETED))).not.toContain('name')
    expect(metaOf(TOOL_COMPLETED)).toEqual({ tool: 'read', status: 'completed', call: 'call_1' })
  })

  test('says nothing about a pending call, which has not started', () => {
    // It fires before the arguments have even arrived, so it would add a line
    // per tool call carrying nothing the running line does not already say.
    expect(describeActivity(TOOL_PENDING, SESSION)).toBeNull()
  })

  test('reports the accounting a finished step carries', () => {
    expect(metaOf(STEP_FINISH)).toEqual({ inputTokens: 1200, outputTokens: 340, reasoningTokens: 12, cost: 0.004 })
  })

  test.each([
    [BUSY, 'busy'],
    [IDLE, 'idle'],
  ])('reports the session status %#', (event, status) => {
    expect(metaOf(event)).toEqual({ status })
  })

  test('reports a provider retry with the attempt number', () => {
    // The most operationally interesting status there is: it says the run is
    // being rate limited rather than merely slow.
    expect(metaOf(RETRY)).toEqual({ status: 'retry', attempt: 1 })
  })

  test('never quotes the provider’s message back, only the attempt', () => {
    expect(JSON.stringify(metaOf(RETRY))).not.toContain('slow down')
  })

  test('never carries the model’s own text', () => {
    expect(describeActivity(TEXT_PART, SESSION)).toBeNull()
    expect(describeActivity(PART_DELTA, SESSION)).toBeNull()
  })

  test('ignores an event about a different session', () => {
    expect(describeActivity(TOOL_RUNNING, OTHER)).toBeNull()
    expect(describeActivity(STEP_FINISH, OTHER)).toBeNull()
    expect(describeActivity(BUSY, OTHER)).toBeNull()
  })

  test.each([
    [PLUGIN_ADDED],
    [{ type: 'catalog.updated', properties: {} }],
    [{ type: 'session.status', properties: { sessionID: SESSION } }],
    [{ type: 'message.part.updated', properties: { sessionID: SESSION, part: { type: 'tool' } } }],
    [{}],
    ['not an event'],
    [null],
  ])('says nothing about %p rather than failing on it', (event) => {
    // An unknown or moved shape is normal — the SDK's generated `Event` union is
    // already behind its own server — and must never be able to fail a phase
    // that was otherwise going fine.
    expect(describeActivity(event, SESSION)).toBeNull()
  })
})

describe('createProgressTracker', () => {
  test('logs each activity as it arrives', () => {
    const { log, lines } = recorder()
    const tracker = createProgressTracker(SESSION, log)

    tracker.observe(TOOL_RUNNING)
    tracker.observe(STEP_FINISH)

    expect(lines.map((line) => line.message)).toEqual(['Model tool call', 'Model step finished'])
  })

  test('collapses a repeated status, which is republished between every step', () => {
    // Ten `busy` events in a short recorded run; a hundred-step turn would bury
    // the tool calls that carry the real information.
    const { log, lines } = recorder()
    const tracker = createProgressTracker(SESSION, log)

    tracker.observe(BUSY)
    tracker.observe(BUSY)
    tracker.observe(BUSY)
    tracker.observe(IDLE)

    expect(lines.map((line) => line.message)).toEqual(['Model session status', 'Model session status'])
  })

  test('reports the same status again after something else happened', () => {
    const { log, lines } = recorder()
    const tracker = createProgressTracker(SESSION, log)

    tracker.observe(BUSY)
    tracker.observe(IDLE)
    tracker.observe(BUSY)

    expect(lines).toHaveLength(3)
  })

  test('counts a tool call once it starts, not when it finishes', () => {
    // Both orderings sum to one for a call that does both, so this is the pair
    // that says which end is counted — and a tool that starts and never
    // finishes must still be counted.
    const { log } = recorder()
    const started = createProgressTracker(SESSION, log)
    const finished = createProgressTracker(SESSION, log)

    started.observe(TOOL_RUNNING)
    finished.observe(TOOL_COMPLETED)

    expect(started.snapshot().toolCalls).toBe(1)
    expect(finished.snapshot().toolCalls).toBe(0)
  })

  test('does not collapse two identical tool calls the way it collapses a status', () => {
    // Tool activities carry a status too, so a collapse rule that keys off
    // "has a status" would silently hide a repeated call.
    const { log, lines } = recorder()
    const tracker = createProgressTracker(SESSION, log)

    tracker.observe(TOOL_RUNNING)
    tracker.observe(TOOL_RUNNING)

    expect(lines).toHaveLength(2)
  })

  test('accumulates what the turn has done, for the heartbeat to report', () => {
    const { log } = recorder()
    const tracker = createProgressTracker(SESSION, log)

    tracker.observe(TOOL_RUNNING)
    tracker.observe(TOOL_COMPLETED)
    tracker.observe(STEP_FINISH)
    tracker.observe(STEP_FINISH)

    expect(tracker.snapshot()).toEqual({
      // One call, counted when it started — not twice for start and finish.
      lastAction: 'finished a step',
      toolCalls: 1,
      tokens: 3080,
      cost: 0.008,
    })
  })

  test('starts by saying so, rather than claiming nothing happened', () => {
    const { log } = recorder()

    expect(createProgressTracker(SESSION, log).snapshot()).toEqual({
      lastAction: 'starting',
      toolCalls: 0,
      tokens: 0,
      cost: 0,
    })
  })

  test('remembers the last thing it saw the model doing', () => {
    const { log } = recorder()
    const tracker = createProgressTracker(SESSION, log)

    tracker.observe(TOOL_RUNNING)

    expect(tracker.snapshot().lastAction).toBe('read (running)')
  })
})

describe('followEvents', () => {
  test('drains a stream into the tracker', async () => {
    const { log, lines } = recorder()
    const tracker = createProgressTracker(SESSION, log)

    await followEvents(streamOf([PLUGIN_ADDED, TOOL_RUNNING, TEXT_PART, STEP_FINISH]), tracker).done

    expect(lines).toHaveLength(2)
  })

  test('a stream that dies mid-run does not reject', async () => {
    // The stream dies whenever the server does, including during an ordinary
    // close(). A teardown race must not become an unhandled rejection that
    // fails a run whose work is already finished.
    const { log, lines } = recorder()
    const tracker = createProgressTracker(SESSION, log)

    await followEvents(dyingStream(TOOL_RUNNING), tracker).done

    expect(lines).toHaveLength(1)
  })

  test('stop ends the drain on a stream that would otherwise never finish', async () => {
    // The SDK's SSE client reconnects for ever by default, so closing the
    // server does not end the stream. Verified against a real one: the
    // generator was still open eight seconds after the server was gone, and a
    // teardown that waited on it hung the job until its own timeout.
    const { log } = recorder()
    const tracker = createProgressTracker(SESSION, log)
    const follower = followEvents(endlessStream(), tracker)

    follower.stop()

    await follower.done
  })

  test('stops observing once stopped, even if more arrives', async () => {
    const { log, lines } = recorder()
    const tracker = createProgressTracker(SESSION, log)
    const follower = followEvents(streamOf([TOOL_RUNNING, STEP_FINISH, BUSY]), tracker)

    follower.stop()
    await follower.done

    expect(lines).toEqual([])
  })
})

describe('withHeartbeat', () => {
  const snapshot = (): ProgressSnapshot => ({ lastAction: 'read (running)', toolCalls: 3, tokens: 900, cost: 0.01 })

  /** Fires the tick on demand rather than after a real minute. */
  const manual = (): {
    schedule: (tick: () => void, everyMs: number) => { cancel: () => void }
    fire: () => void
    cancels: number
    everyMs: number[]
  } => {
    const state = { cancels: 0, everyMs: [] as number[], ticks: [] as Array<() => void> }
    return {
      everyMs: state.everyMs,
      get cancels(): number {
        return state.cancels
      },
      fire: (): void => {
        for (const tick of state.ticks) tick()
      },
      schedule: (tick, everyMs) => {
        state.ticks.push(tick)
        state.everyMs.push(everyMs)
        return {
          cancel: (): void => {
            state.cancels += 1
          },
        }
      },
    }
  }

  test('passes the result through', async () => {
    const { log } = recorder()

    expect(await withHeartbeat(Promise.resolve('done'), { everyMs: 1000, log, snapshot })).toBe('done')
  })

  test('says the job is not stuck, and what it has done so far', async () => {
    const { log, lines } = recorder()
    const timer = manual()
    let settle: (value: string) => void = () => {}
    const work = new Promise<string>((resolve) => {
      settle = resolve
    })

    const running = withHeartbeat(work, { everyMs: 60_000, log, snapshot, schedule: timer.schedule })
    timer.fire()
    settle('done')
    await running

    expect(lines).toHaveLength(1)
    expect(lines[0]?.message).toContain('not stuck')
    expect(lines[0]?.meta).toMatchObject({ lastAction: 'read (running)', toolCalls: 3, tokens: 900 })
    // Elapsed, not a timestamp: a wall-clock epoch here reads as a job that has
    // been running since 1970.
    expect(elapsedOf(lines[0])).toBeLessThan(60_000)
  })

  test('really does tick on a clock, and really does stop', async () => {
    // Everything above injects `schedule`, which leaves the one line that
    // creates and clears the actual interval untested — the same line whose
    // absence would hold the process open past the end of the job.
    const { log, lines } = recorder()
    let settle: (value: string) => void = () => {}
    const work = new Promise<string>((resolve) => {
      settle = resolve
    })

    const running = withHeartbeat(work, { everyMs: 5, log, snapshot })
    await until(() => lines.length > 0)
    settle('done')
    await running

    const afterFinish = lines.length
    await Bun.sleep(60)

    expect(lines).toHaveLength(afterFinish)
  })

  test('stops ticking once the work is done', async () => {
    const { log } = recorder()
    const timer = manual()

    await withHeartbeat(Promise.resolve('done'), { everyMs: 60_000, log, snapshot, schedule: timer.schedule })

    expect(timer.cancels).toBe(1)
  })

  test('stops ticking when the work fails, not only when it succeeds', async () => {
    // The case that matters: the deadline rejecting leaves the model call still
    // pending, and an interval that outlives the job holds the process open.
    const { log } = recorder()
    const timer = manual()

    await expect(
      withHeartbeat(Promise.reject(new Error('timed out')), {
        everyMs: 60_000,
        log,
        snapshot,
        schedule: timer.schedule,
      }),
    ).rejects.toThrow('timed out')

    expect(timer.cancels).toBe(1)
  })

  test('hands the same snapshot to a second reader, and still writes the log line', async () => {
    // The heartbeat already knows everything the live status comment wants to
    // say, and said it only into a log nobody has a link to. Routing it keeps
    // one clock in the pipeline — and the log half is unchanged, which is the
    // half a CI reader still depends on.
    const { log, lines } = recorder()
    const timer = manual()
    const ticks: ProgressSnapshot[] = []

    await withHeartbeat(Promise.resolve('done'), {
      everyMs: 60_000,
      log,
      snapshot,
      schedule: timer.schedule,
      onTick: (progress) => void ticks.push(progress),
    })
    timer.fire()

    expect(ticks).toEqual([snapshot()])
    expect(lines).toHaveLength(1)
    expect(lines[0]?.message).toContain('not stuck')
  })

  test('a heartbeat with no second reader still ticks', async () => {
    const { log, lines } = recorder()
    const timer = manual()

    await withHeartbeat(Promise.resolve('done'), { everyMs: 60_000, log, snapshot, schedule: timer.schedule })
    timer.fire()

    expect(lines).toHaveLength(1)
  })

  test('schedules nothing at all when disabled', async () => {
    const { log } = recorder()
    const timer = manual()

    await withHeartbeat(Promise.resolve('done'), { everyMs: 0, log, snapshot, schedule: timer.schedule })

    expect(timer.everyMs).toEqual([])
  })
})
