// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createScenarioRuntimeExtensionLifecycle } from './runtime-extension.js'

describe('scenario runtime extension lifecycle', () => {
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
    const runtimeExtensions = createScenarioRuntimeExtensionLifecycle(() => extensions)

    await Promise.all([runtimeExtensions.start(), runtimeExtensions.start()])
    await runtimeExtensions.stop()

    expect(lifecycle).toEqual(['start', 'cleanup'])
  })
})
