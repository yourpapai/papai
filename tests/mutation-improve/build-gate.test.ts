// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { recordBuildFailure } from '../../mutation-improve/src/build-gate.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('recordBuildFailure', () => {
  test('persists both streams to build-output.log and returns them as the reason', async () => {
    const iterPath = makeTempDir('build-gate-')
    const reason = await recordBuildFailure(iterPath, {
      stdout: '✗ test failed\n(fail) some test\n',
      stderr: 'error: script "check:full" exited with code 1\n',
    })
    expect(reason).toContain('error: script "check:full" exited with code 1')
    expect(reason).toContain('(fail) some test')
    const log = await readFile(path.join(iterPath, 'build-output.log'), 'utf8')
    expect(log).toContain('error: script "check:full" exited with code 1')
    expect(log).toContain('(fail) some test')
  })

  test('omits the separator when one stream is empty', async () => {
    const iterPath = makeTempDir('build-gate-')
    const reason = await recordBuildFailure(iterPath, { stdout: 'only stdout\n', stderr: '' })
    expect(reason).toBe('only stdout\n')
  })

  test('tail-bounds the reason while the log keeps the full output', async () => {
    const iterPath = makeTempDir('build-gate-')
    const marker = 'UNIQUE-BUILD-FAILURE-MARKER'
    const reason = await recordBuildFailure(iterPath, {
      stdout: `${'x'.repeat(6000)}\n${marker}\n`,
      stderr: '',
    })
    expect(reason).toContain(marker)
    expect(reason.length).toBeLessThan(4500)
    const log = await readFile(path.join(iterPath, 'build-output.log'), 'utf8')
    expect(log.length).toBeGreaterThan(6000)
    expect(log).toContain(marker)
  })
})
