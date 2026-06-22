// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for config types
 */

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { ALL_CONFIG_KEYS, isAllowedDynamicConfigKey, isConfigKey, type ConfigKey } from '../../src/types/config.js'

describe('config types', () => {
  describe('ALL_CONFIG_KEYS', () => {
    test('ALL_CONFIG_KEYS contains the static preference and AI-output keys', () => {
      expect(ALL_CONFIG_KEYS).toEqual([
        'timezone',
        'mcp_endpoints',
        'ai_tool_visibility',
        'ai_reasoning_visibility',
        'ai_output_detail_level',
        'structured_prompt_surface',
      ])
    })
  })

  describe('isConfigKey', () => {
    test('returns true for the valid static per-user keys', () => {
      const validKeys: ConfigKey[] = ['timezone', 'mcp_endpoints']

      for (const key of validKeys) {
        expect(isConfigKey(key)).toBe(true)
      }
    })

    test('returns true for the AI-output keys', () => {
      for (const key of ['ai_tool_visibility', 'ai_reasoning_visibility', 'ai_output_detail_level'] as const) {
        expect(isConfigKey(key)).toBe(true)
      }
    })

    test('returns true for the structured prompt surface flag', () => {
      expect(isConfigKey('structured_prompt_surface')).toBe(true)
    })

    test('isConfigKey rejects the legacy flat provider keys', () => {
      expect(isConfigKey('kaneo_apikey')).toBe(false)
      expect(isConfigKey('youtrack_token')).toBe(false)
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
      const maybeKey = 'timezone'
      assert(isConfigKey(maybeKey), 'expected isConfigKey to return true for a static key')
      const key: ConfigKey = maybeKey
      expect(key).toBe('timezone')
    })
  })

  describe('isAllowedDynamicConfigKey', () => {
    test('isAllowedDynamicConfigKey still accepts namespaced provider keys', () => {
      expect(isAllowedDynamicConfigKey('plugin:task-provider-kaneo:provider:credential')).toBe(true)
    })

    test('accepts namespaced youtrack token key', () => {
      expect(isAllowedDynamicConfigKey('plugin:task-provider-youtrack:provider:token')).toBe(true)
    })

    test('accepts static config keys', () => {
      expect(isAllowedDynamicConfigKey('timezone')).toBe(true)
      expect(isAllowedDynamicConfigKey('mcp_endpoints')).toBe(true)
      expect(isAllowedDynamicConfigKey('structured_prompt_surface')).toBe(true)
    })

    test('accepts the AI-output config keys', () => {
      expect(isAllowedDynamicConfigKey('ai_tool_visibility')).toBe(true)
      expect(isAllowedDynamicConfigKey('ai_reasoning_visibility')).toBe(true)
      expect(isAllowedDynamicConfigKey('ai_output_detail_level')).toBe(true)
    })

    test('rejects unknown keys', () => {
      expect(isAllowedDynamicConfigKey('kaneo_apikey')).toBe(false)
      expect(isAllowedDynamicConfigKey('youtrack_token')).toBe(false)
    })
  })
})
