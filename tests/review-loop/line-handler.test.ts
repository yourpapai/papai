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
