// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for config types
 */

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { isConfigKey, type ConfigKey } from '../../src/types/config.js'

describe('config types', () => {
  describe('isConfigKey', () => {
    test('returns true for the valid per-user keys', () => {
      const validKeys: ConfigKey[] = ['kaneo_apikey', 'kaneo_workspace_id', 'youtrack_token', 'timezone']

      for (const key of validKeys) {
        expect(isConfigKey(key)).toBe(true)
      }
    })

    test('returns false for invalid keys and for the former LLM keys', () => {
      expect(isConfigKey('invalid_key')).toBe(false)
      expect(isConfigKey('')).toBe(false)
      expect(isConfigKey('llm_api_key')).toBe(false)
      expect(isConfigKey('apikey')).toBe(false)
      // LLM keys moved to system_config in Phase 1
      expect(isConfigKey('llm_apikey')).toBe(false)
      expect(isConfigKey('llm_baseurl')).toBe(false)
      expect(isConfigKey('main_model')).toBe(false)
      expect(isConfigKey('small_model')).toBe(false)
      expect(isConfigKey('embedding_model')).toBe(false)
    })

    test('type guard narrows string to ConfigKey', () => {
      const maybeKey = 'kaneo_apikey'
      assert(isConfigKey(maybeKey), 'expected isConfigKey to return true for a valid key')
      const key: ConfigKey = maybeKey
      expect(key).toBe('kaneo_apikey')
    })
  })
})
