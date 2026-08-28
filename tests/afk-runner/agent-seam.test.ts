// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import assert from 'node:assert'

import { SpawnError, typedSpawn } from '../../afk-runner/src/agent-seam.js'
import { defaultCliDeps } from '../../afk-runner/src/cli.js'
import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'

const result = (overrides: Partial<SpawnResult> = {}): SpawnResult => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  ...overrides,
})

const of = (inner: SpawnFn): SpawnFn => typedSpawn(inner)

/** A realSpawn launch-failure shape: the `error` event resolves with the errno message in stderr. */
const launchFailure = (message = 'spawn opencode ENOENT'): SpawnResult =>
  result({ exitCode: 1, stderr: `${message}\n` })

describe('spawn seam — typed SpawnError for transport failures (C6 D1)', () => {
  it('types a launch-failure result as SpawnError (infra kind), preserving the transport detail', async () => {
    const inner: SpawnFn = () => Promise.resolve(launchFailure())
    const failure = await of(inner)('opencode', ['run'], { cwd: '/tmp' }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(SpawnError)
    assert(failure instanceof SpawnError)
    expect(failure.name).toBe('SpawnError')
    expect(failure.kind).toBe('infra')
    expect(failure.message).toContain('spawn opencode ENOENT')
  })

  it('passes a successful result through unchanged', async () => {
    const ok = result({ exitCode: 0, stdout: '{"value":1}' })
    const inner: SpawnFn = () => Promise.resolve(ok)
    expect(await of(inner)('opencode', ['run'], { cwd: '/tmp' })).toBe(ok)
  })

  it('does not type an agent-level failure the transport did reach: output was produced', async () => {
    const agentError = result({ exitCode: 1, stdout: '{"partial":true}', stderr: 'agent crashed mid-run\n' })
    const inner: SpawnFn = () => Promise.resolve(agentError)
    expect(await of(inner)('opencode', ['run'], { cwd: '/tmp' })).toBe(agentError)
  })

  it('does not type a bare agent exit: non-launch stderr without any produced output stays a plain result', async () => {
    const agentError = result({ exitCode: 1, stderr: 'Error: not logged in\n' })
    const inner: SpawnFn = () => Promise.resolve(agentError)
    expect(await of(inner)('opencode', ['run'], { cwd: '/tmp' })).toBe(agentError)
  })

  it('untyped non-spawn errors stay plain: an inner rejection propagates as the same error, not SpawnError', async () => {
    const kill = new Error('simulated kill before findings-2.json')
    const inner: SpawnFn = () => Promise.reject(kill)
    const failure = await of(inner)('opencode', ['run'], { cwd: '/tmp' }).catch((error: unknown) => error)
    expect(failure).toBe(kill)
    expect(failure).not.toBeInstanceOf(SpawnError)
  })

  it('a timeout result is not a transport failure — watchdogs sit below the seam', async () => {
    const timedOut = result({ exitCode: 1, stderr: 'Process timed out after 1800000ms\n', timedOut: true })
    const inner: SpawnFn = () => Promise.resolve(timedOut)
    expect(await of(inner)('opencode', ['run'], { cwd: '/tmp' })).toBe(timedOut)
  })

  it('the CLI wires the typed seam over realSpawn', () => {
    const seam = of((): Promise<SpawnResult> => Promise.resolve(result()))
    expect(defaultCliDeps('/tmp').spawn.name).toBe(seam.name)
  })
})
