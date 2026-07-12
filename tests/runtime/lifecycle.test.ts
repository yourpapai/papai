// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRuntimeLifecycle } from '../../src/runtime/lifecycle.js'

describe('RuntimeLifecycle', () => {
  test('runs synchronous and asynchronous cleanups once in reverse registration order', async () => {
    const calls: string[] = []
    const lifecycle = createRuntimeLifecycle()
    lifecycle.add('first', () => void calls.push('first'))
    lifecycle.add('second', async () => {
      await Promise.resolve()
      calls.push('second')
    })

    expect(lifecycle.pending()).toEqual(['second', 'first'])

    await lifecycle.stop()
    await lifecycle.stop()

    expect(calls).toEqual(['second', 'first'])
    expect(lifecycle.pending()).toEqual([])
  })

  test('runs higher-priority cleanup before lower-priority cleanup', async () => {
    const calls: string[] = []
    const lifecycle = createRuntimeLifecycle()
    lifecycle.add('database', () => void calls.push('database'), 0)
    lifecycle.add('ingress', () => void calls.push('ingress'), 100)
    lifecycle.add('extensions', () => void calls.push('extensions'), 50)

    expect(lifecycle.pending()).toEqual(['ingress', 'extensions', 'database'])

    await lifecycle.stop()

    expect(calls).toEqual(['ingress', 'extensions', 'database'])
  })

  test('attempts every cleanup and reports failures in execution order', async () => {
    const calls: string[] = []
    const lifecycle = createRuntimeLifecycle()
    lifecycle.add('one', () => {
      calls.push('one')
      throw new Error('one failed')
    })
    lifecycle.add('successful', () => {
      calls.push('successful')
      return Promise.resolve()
    })
    lifecycle.add('two', () => {
      calls.push('two')
      return Promise.reject(new Error('two failed'))
    })

    await expect(lifecycle.stop()).rejects.toThrow('Runtime cleanup failed: two: two failed; one: one failed')

    expect(calls).toEqual(['two', 'successful', 'one'])
    expect(lifecycle.pending()).toEqual([])
  })

  test('normalizes non-Error cleanup failures', async () => {
    const lifecycle = createRuntimeLifecycle()
    lifecycle.add(
      'string failure',
      () =>
        new Promise<void>((_resolve, reject) => {
          const rejectUnknown: (reason?: unknown) => void = reject
          rejectUnknown('not an Error')
        }),
    )

    await expect(lifecycle.stop()).rejects.toThrow('Runtime cleanup failed: string failure: not an Error')
  })

  test('does not rerun failed cleanups on repeated stop', async () => {
    let attempts = 0
    const lifecycle = createRuntimeLifecycle()
    lifecycle.add('failing', () => {
      attempts += 1
      throw new Error('failed')
    })

    await expect(lifecycle.stop()).rejects.toThrow('Runtime cleanup failed: failing: failed')
    await lifecycle.stop()

    expect(attempts).toBe(1)
  })

  test('rolls back registered resources after partial startup failure', async () => {
    const calls: string[] = []
    const lifecycle = createRuntimeLifecycle()

    const start = (): Promise<void> => {
      lifecycle.add('database', () => void calls.push('database'))
      lifecycle.add('plugin runtime', () => {
        calls.push('plugin runtime')
        return Promise.resolve()
      })
      return Promise.reject(new Error('ingress startup failed'))
    }

    try {
      await start()
    } catch {
      await lifecycle.stop()
    }

    expect(calls).toEqual(['plugin runtime', 'database'])
    expect(lifecycle.pending()).toEqual([])
  })
})
