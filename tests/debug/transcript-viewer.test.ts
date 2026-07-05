// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getViewerMagiConfig } from '../../src/debug/transcript-viewer.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('getViewerMagiConfig', () => {
  test('returns trimmed baseUrl and token when both configured', async () => {
    await setupTestDb()
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.example/', 'test')
    setPluginAdminConfig('acp', 'magi_token', '  sekret  ', 'test')

    expect(getViewerMagiConfig()).toEqual({ baseUrl: 'https://magi.example', token: 'sekret' })
  })

  test('returns null when nothing configured', async () => {
    await setupTestDb()

    expect(getViewerMagiConfig()).toBeNull()
  })
})
