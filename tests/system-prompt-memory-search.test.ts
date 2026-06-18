// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildProviderlessSystemPrompt } from '../src/system-prompt.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('memory search preamble', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('present only when the search_memory tool is enabled', () => {
    const withSearch = buildProviderlessSystemPrompt('g:thread:a', new Set(['search_memory']), {
      askPermissionAvailable: true,
      contextType: 'group',
    })
    const without = buildProviderlessSystemPrompt('g:thread:a', new Set(['create_task']), {
      askPermissionAvailable: true,
      contextType: 'group',
    })
    expect(withSearch.toLowerCase()).toContain('priority order')
    expect(without.toLowerCase()).not.toContain('priority order')
  })
})
