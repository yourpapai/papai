// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import type { TrustedModule } from '../../src/ports/module.js'

describe('TrustedModule', () => {
  test('can declare the tools it contributes alongside migrations and onActivate', () => {
    const mod: TrustedModule = {
      id: 'fixture',
      migrations: [],
      tools: [
        {
          name: 'do_it',
          description: 'do_it',
          inputSchema: z.object({}),
          execute: (): Promise<null> => Promise.resolve(null),
        },
      ],
      onActivate: () => {},
    }
    expect(mod.tools?.[0]?.name).toBe('do_it')
  })

  test('tools is optional', () => {
    const mod: TrustedModule = { id: 'fixture' }
    expect(mod.tools).toBeUndefined()
  })
})
