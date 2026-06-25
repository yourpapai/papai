// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('consumePluginQuota', () => {
  let consumePluginQuota: typeof import('../../src/plugins/rate-limit.js').consumePluginQuota
  let consumeWebFetchQuota: typeof import('../../src/web/rate-limit.js').consumeWebFetchQuota
  let PLUGIN_QUOTA_LIMIT: number

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    ;({ consumePluginQuota, PLUGIN_QUOTA_LIMIT } = await import('../../src/plugins/rate-limit.js'))
    ;({ consumeWebFetchQuota } = await import('../../src/web/rate-limit.js'))
  })

  test('allows up to the plugin limit, then blocks', () => {
    for (let index = 0; index < PLUGIN_QUOTA_LIMIT; index += 1) {
      expect(consumePluginQuota('audio-transcribe', 'user-1', 0).allowed).toBe(true)
    }
    expect(consumePluginQuota('audio-transcribe', 'user-1', 0)).toMatchObject({ allowed: false, remaining: 0 })
  })

  test('grants more headroom than the web-fetch quota of 20', () => {
    expect(PLUGIN_QUOTA_LIMIT).toBeGreaterThan(20)
  })

  test('is per-user: one user exhausting their quota does not affect another', () => {
    for (let index = 0; index < PLUGIN_QUOTA_LIMIT; index += 1) consumePluginQuota('audio-transcribe', 'user-1', 0)
    expect(consumePluginQuota('audio-transcribe', 'user-1', 0).allowed).toBe(false)
    expect(consumePluginQuota('audio-transcribe', 'user-2', 0).allowed).toBe(true)
  })

  test('is per-plugin: distinct plugin ids do not share a bucket', () => {
    for (let index = 0; index < PLUGIN_QUOTA_LIMIT; index += 1) consumePluginQuota('audio-transcribe', 'user-1', 0)
    expect(consumePluginQuota('audio-transcribe', 'user-1', 0).allowed).toBe(false)
    expect(consumePluginQuota('other-plugin', 'user-1', 0).allowed).toBe(true)
  })

  test('does not drain the shared web-fetch quota', () => {
    for (let index = 0; index < PLUGIN_QUOTA_LIMIT; index += 1) consumePluginQuota('audio-transcribe', 'user-1', 0)
    // web_fetch for the same underlying user still has its full 20.
    for (let index = 0; index < 20; index += 1) {
      expect(consumeWebFetchQuota('user-1', 0).allowed).toBe(true)
    }
  })
})
