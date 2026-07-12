// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createScenarioRuntimeExtensionLifecycle } from './runtime-extension.js'

describe('scenario runtime extension lifecycle', () => {
  test('passes extensions a structural event recorder without exposing runtime dependencies', async () => {
    const calls: unknown[][] = []
    const records: unknown[][] = []
    const runtimeExtensions = createScenarioRuntimeExtensionLifecycle(
      () => [
        {
          start(context): void {
            calls.push([context])
            context.record('scenario.runtime-extension.started', { contribution: 'tool' })
          },
        },
      ],
      {
        record(...args): void {
          records.push([...args])
        },
      },
    )

    await runtimeExtensions.start()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(1)
    expect(records).toEqual([['scenario.runtime-extension.started', { contribution: 'tool' }]])
  })

  test('starts an extension once and runs its cleanup when stopped', async () => {
    const lifecycle: string[] = []
    const extensions = [
      {
        start: (): (() => void) => {
          lifecycle.push('start')
          return (): void => {
            lifecycle.push('cleanup')
          }
        },
      },
    ]
    const runtimeExtensions = createScenarioRuntimeExtensionLifecycle(() => extensions, {
      record: (): void => undefined,
    })

    await Promise.all([runtimeExtensions.start(), runtimeExtensions.start()])
    await runtimeExtensions.stop()

    expect(lifecycle).toEqual(['start', 'cleanup'])
  })
})
