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
    expect(deltas).toEqual([{ input: 5, output: 2, reasoning: 1, cost: 0.5 }])
  })

  test('tool progress goes to reporter.slot and dispose clears it', async () => {
    const cwd = makeTempDir('line-handler-slot-')
    const slots: Array<readonly [string, string | null]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
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
    expect(slots[slots.length - 1]).toEqual(['drain', null])
  })
})
