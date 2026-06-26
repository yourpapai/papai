// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildSystemPrompt } from '../src/system-prompt.js'
import { createMockProvider } from './tools/mock-provider.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('system prompt — Kaneo assignment guidance', () => {
  // buildSystemPrompt reads per-context tool prefs from the DB (getToolPrefs); without a
  // migrated DB installed it falls back to whatever global instance a prior test left and
  // throws "no such table: user_config" in CI (no dev papai.db). Install a real test DB.
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('group prompt includes find_user assignment guidance when find_user is enabled', () => {
    const provider = createMockProvider()
    const enabled = new Set(['find_user', 'create_task', 'update_task'])
    const prompt = buildSystemPrompt(provider, 'ctx-group', enabled, {
      askPermissionAvailable: false,
      contextType: 'group',
    })
    expect(prompt).toContain('find_user')
  })

  test('group prompt does not include find_user assignment guidance when find_user is not enabled', () => {
    const provider = createMockProvider()
    const enabled = new Set(['create_task', 'update_task'])
    const prompt = buildSystemPrompt(provider, 'ctx-group', enabled, {
      askPermissionAvailable: false,
      contextType: 'group',
    })
    // The guidance text is specifically about assignment workflow — the literal phrase
    // "first call find_user" should not appear without find_user enabled.
    expect(prompt).not.toContain('first call find_user')
  })

  test('DM prompt does not include find_user assignment guidance even when find_user is enabled', () => {
    const provider = createMockProvider()
    const enabled = new Set(['find_user', 'create_task', 'update_task'])
    const prompt = buildSystemPrompt(provider, 'ctx-dm', enabled, {
      askPermissionAvailable: false,
      contextType: 'dm',
    })
    expect(prompt).not.toContain('first call find_user')
  })
})
