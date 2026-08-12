// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import type { RunAgentOptions, SpawnResult } from '../../review-loop/src/agent-runner.js'
import { createLineHandler, enqueueLog } from '../../review-loop/src/line-handler.js'
import type { ProgressReporter, UsageDelta } from '../../review-loop/src/progress-log.js'
import { RunStats } from '../../review-loop/src/run-stats.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const makeOptions = (cwd: string, logPath: string): RunAgentOptions<{ ok: boolean }> => ({
  spawn: (): Promise<SpawnResult> => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
  model: 'm',
  cwd,
  prompt: 'p',
  outputPath: path.join(cwd, 'result.json'),
  outputSchema: z.object({ ok: z.boolean() }),
  label: 'drain',
  logPath,
  extraArgs: [],
})

describe('createLineHandler log draining', () => {
  test('dispose resolves only after every queued log write has hit disk', async () => {
    const cwd = makeTempDir('line-handler-drain-')
    const logPath = path.join(cwd, 'agent.log')
    const handler = createLineHandler(makeOptions(cwd, logPath))
    handler.onLine('first')
    handler.onLine('second')
    await handler.dispose()
    expect(readFileSync(logPath, 'utf8')).toBe('first\nsecond\n')
  })

  test('enqueueLog never rejects when the destination disappears (best-effort logging)', async () => {
    const cwd = makeTempDir('line-handler-best-effort-')
    const logPath = path.join(cwd, 'missing-dir', 'agent.log')
    const handler = createLineHandler(makeOptions(cwd, logPath))
    enqueueLog(handler.ctx, 'dropped\n')
    await handler.dispose()
  })
})

describe('createLineHandler reporter wiring', () => {
  function makeReporter(overrides: Partial<ProgressReporter>): ProgressReporter {
    return {
      dynamic: false,
      event: () => {},
      live: () => {},
      clearLive: () => {},
      log: () => {},
      ...overrides,
    }
  }

  function matchesDrainRead(entry: readonly [string, string | null]): boolean {
    const [key, line] = entry
    return key === 'drain' && line !== null && line.includes('read')
  }

  test('step_finish forwards usage to the reporter', () => {
    const cwd = makeTempDir('line-handler-usage-')
    const deltas: UsageDelta[] = []
    const reporter = makeReporter({
      usage: (d) => {
        deltas.push(d)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(
      JSON.stringify({
        type: 'step_finish',
        part: { reason: 'stop', tokens: { input: 5, output: 2, reasoning: 1 }, cost: 0.5 },
      }),
    )
    expect(deltas).toEqual([{ input: 5, output: 2, reasoning: 1, cost: 0.5, label: 'drain', model: 'm' }])
  })

  test('step_finish delta carries label/model and tool calls accumulate per step', () => {
    const cwd = makeTempDir('line-handler-stats-')
    const stats = new RunStats()
    const deltas: UsageDelta[] = []
    const reporter = makeReporter({
      stats,
      usage: (d) => {
        deltas.push(d)
        stats.addUsage('drain', d)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    const stepStart = JSON.stringify({ type: 'step_start', timestamp: 1, part: {} })
    const stepFinish = JSON.stringify({
      type: 'step_finish',
      part: { reason: 'stop', tokens: { input: 5, output: 2, reasoning: 1 }, cost: 0 },
    })
    const tool = (id: string): string =>
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: id, state: { status: 'running', input: { filePath: '/a/cli.ts' } } },
      })
    handler.onLine(stepStart)
    handler.onLine(tool('c1'))
    handler.onLine(stepFinish)
    handler.onLine(stepStart)
    handler.onLine(tool('c2'))
    // duplicate callID from a later step must not double-count
    handler.onLine(tool('c1'))
    handler.onLine(stepFinish)
    expect(deltas).toEqual([
      { input: 5, output: 2, reasoning: 1, cost: 0, label: 'drain', model: 'm' },
      { input: 5, output: 2, reasoning: 1, cost: 0, label: 'drain', model: 'm' },
    ])
    expect(stats.snapshot().totals.toolCalls).toBe(2)
    expect(stats.snapshot().perLabel['drain']?.input).toBe(10)
  })

  test('tool progress goes to reporter.slot and dispose commits it with a done marker', async () => {
    const cwd = makeTempDir('line-handler-slot-')
    const slots: Array<readonly [string, string | null]> = []
    const commits: Array<readonly [string, string | undefined]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
      commit: (key, line) => {
        commits.push([key, line] as const)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine(
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: 'c1', state: { status: 'running', input: { filePath: '/a/cli.ts' } } },
      }),
    )
    expect(slots.some(matchesDrainRead)).toBe(true)
    await handler.dispose()
    expect(commits).toHaveLength(1)
    expect(commits[0]![0]).toBe('drain')
    expect(commits[0]![1]).toContain('\u2713')
    expect(commits[0]![1]).toContain('read')
    expect(slots.every(([, line]) => line !== null)).toBe(true)
  })

  test('commitOnDispose:false leaves the slot live (no commit, no clear)', async () => {
    const cwd = makeTempDir('line-handler-keep-')
    const slots: Array<readonly [string, string | null]> = []
    const commits: Array<readonly [string, string | undefined]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
      commit: (key, line) => {
        commits.push([key, line] as const)
      },
    })
    const handler = createLineHandler({
      ...makeOptions(cwd, path.join(cwd, 'agent.log')),
      reporter,
      slotKey: 'iter',
      commitOnDispose: false,
    })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine(
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: 'c1', state: { status: 'running', input: { filePath: '/a/cli.ts' } } },
      }),
    )
    await handler.dispose()
    expect(commits).toEqual([])
    expect(slots).toHaveLength(1)
    expect(slots.every(([, line]) => line !== null)).toBe(true)
  })

  test('slotKey overrides the slot identity', async () => {
    const cwd = makeTempDir('line-handler-key-')
    const slots: Array<readonly [string, string | null]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
    })
    const handler = createLineHandler({
      ...makeOptions(cwd, path.join(cwd, 'agent.log')),
      reporter,
      slotKey: 'iter',
      commitOnDispose: false,
    })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine(
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: 'c1', state: { status: 'running', input: { filePath: '/a/cli.ts' } } },
      }),
    )
    expect(slots).toHaveLength(1)
    expect(slots.every(([key]) => key === 'iter')).toBe(true)
    await handler.dispose()
  })

  test('step_finish emits no permanent event, but re-renders the live line with cumulative tokens', async () => {
    const cwd = makeTempDir('line-handler-tokens-')
    const events: string[] = []
    const slots: Array<readonly [string, string | null]> = []
    const reporter = makeReporter({
      event: (msg) => {
        events.push(msg)
      },
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine(
      JSON.stringify({
        type: 'step_finish',
        part: { reason: 'stop', tokens: { input: 5, output: 2, reasoning: 1 }, cost: 0 },
      }),
    )
    expect(events).toEqual([])
    const last = slots[slots.length - 1]![1]!
    expect(last).toContain('in 5 / out 2')
    await handler.dispose()
  })

  test('an agent that died before its first step clears the slot instead of committing', async () => {
    const cwd = makeTempDir('line-handler-unstarted-')
    const slots: Array<readonly [string, string | null]> = []
    const commits: Array<readonly [string, string | undefined]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
      commit: (key, line) => {
        commits.push([key, line] as const)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    await handler.dispose()
    expect(commits).toEqual([])
    expect(slots).toEqual([['drain', null]])
  })

  test('a reporter without commit falls back to clearing the slot on dispose', async () => {
    const cwd = makeTempDir('line-handler-nocommit-')
    const slots: Array<readonly [string, string | null]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    await handler.dispose()
    expect(slots[slots.length - 1]).toEqual(['drain', null])
  })
})
