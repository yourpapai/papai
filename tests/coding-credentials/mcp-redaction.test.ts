// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { resolveMcpRedactionConfig, setMcpRedactionConfig } from '../../src/coding-credentials/mcp-redaction.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('mcp-redaction admin config', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns null when unset', () => {
    expect(resolveMcpRedactionConfig('pi-1')).toBeNull()
  })

  test('round-trips a stored config', () => {
    setMcpRedactionConfig('pi-1', {
      model_url: 'https://model.example.com/v1',
      api_key: 'secret',
      model_name: 'redactor-mini',
      timeout_ms: 60000,
    })
    expect(resolveMcpRedactionConfig('pi-1')).toEqual({
      model_url: 'https://model.example.com/v1',
      api_key: 'secret',
      model_name: 'redactor-mini',
      timeout_ms: 60000,
    })
  })

  test('is scoped per platform instance', () => {
    setMcpRedactionConfig('pi-1', { model_url: 'https://a.example.com', api_key: 'k', model_name: 'm' })
    expect(resolveMcpRedactionConfig('pi-2')).toBeNull()
  })
})
