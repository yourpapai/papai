// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildProviderlessSystemPrompt } from '../src/system-prompt.js'
import { setupTestDb } from './utils/test-helpers.js'

describe('WORKFLOW confirmation instruction', () => {
  // assembleSystemPrompt reads tool prefs from the DB (getToolPrefs -> user_config),
  // so seed a migrated in-memory DB rather than relying on an ambient papai.db file.
  beforeEach(async () => {
    await setupTestDb()
  })

  test('step 4 tells the model to name what it did', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-1', new Set<string>(), { askPermissionAvailable: false })
    expect(prompt).toContain('names what you did')
  })
})
