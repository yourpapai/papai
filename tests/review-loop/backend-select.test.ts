// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { BackendSelectionError, resolveAgentBackend } from '../../review-loop/src/backend-select.js'

describe('resolveAgentBackend', () => {
  test('ANTHROPIC_API_KEY alone selects the bare profile', () => {
    const resolved = resolveAgentBackend('claude', { ANTHROPIC_API_KEY: 'sk-ant-key-0123456789' })
    expect(resolved.profile).toBe('bare')
    expect(resolved.credentialName).toBe('ANTHROPIC_API_KEY')
    expect(resolved.credentialValue).toBe('sk-ant-key-0123456789')
  })

  test('CLAUDE_CODE_OAUTH_TOKEN alone selects the native profile', () => {
    const resolved = resolveAgentBackend('claude', { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-0123456789' })
    expect(resolved.profile).toBe('native')
    expect(resolved.credentialName).toBe('CLAUDE_CODE_OAUTH_TOKEN')
    expect(resolved.credentialValue).toBe('oauth-token-0123456789')
  })

  test('both set is refused with code CLAUDE_CREDENTIALS naming both variables', () => {
    const resolve = (): unknown =>
      resolveAgentBackend('claude', {
        ANTHROPIC_API_KEY: 'sk-ant-key-0123456789',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-0123456789',
      })
    expect(resolve).toThrow(BackendSelectionError)
    expect(resolve).toThrow(/CLAUDE_CREDENTIALS/u)
    expect(resolve).toThrow(/ANTHROPIC_API_KEY/u)
    expect(resolve).toThrow(/CLAUDE_CODE_OAUTH_TOKEN/u)
  })

  test('neither set is refused with code CLAUDE_CREDENTIALS naming both variables', () => {
    const resolve = (): unknown => resolveAgentBackend('claude', {})
    expect(resolve).toThrow(BackendSelectionError)
    expect(resolve).toThrow(/CLAUDE_CREDENTIALS/u)
    expect(resolve).toThrow(/ANTHROPIC_API_KEY/u)
    expect(resolve).toThrow(/CLAUDE_CODE_OAUTH_TOKEN/u)
  })

  test('a set LLM_API_KEY is refused with code LLM_CREDENTIALS', () => {
    const resolve = (): unknown =>
      resolveAgentBackend('claude', { ANTHROPIC_API_KEY: 'sk-ant-key-0123456789', LLM_API_KEY: 'gateway-key' })
    expect(resolve).toThrow(BackendSelectionError)
    expect(resolve).toThrow(/LLM_CREDENTIALS/u)
    expect(resolve).toThrow(/LLM_API_KEY/u)
  })

  test('an empty-valued LLM_API_KEY reads as unset (the CI forwarding shape)', () => {
    // The workflow forwards unset secrets as the empty string; a name-present
    // reading would refuse every CI claude-route run at loop startup.
    const resolved = resolveAgentBackend('claude', { ANTHROPIC_API_KEY: 'sk-ant-key-0123456789', LLM_API_KEY: '' })
    expect(resolved.profile).toBe('bare')
  })

  test('a whitespace-only non-selected Anthropic spelling reads as unset', () => {
    const resolved = resolveAgentBackend('claude', {
      ANTHROPIC_API_KEY: 'sk-ant-key-0123456789',
      CLAUDE_CODE_OAUTH_TOKEN: '   ',
    })
    expect(resolved.profile).toBe('bare')
    expect(resolved.credentialName).toBe('ANTHROPIC_API_KEY')
  })

  test('the CI forwarding shape verbatim resolves rather than refusing', () => {
    const resolved = resolveAgentBackend('claude', {
      ANTHROPIC_API_KEY: 'sk-ant-key-0123456789',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      LLM_API_KEY: '',
      LLM_BASE_URL: '',
    })
    expect(resolved.profile).toBe('bare')
    expect(resolved.credentialValue).toBe('sk-ant-key-0123456789')
  })

  test('a whitespace-only credential value counts as set after trim', () => {
    // "Set" means non-empty after trim; the surviving value is the trimmed one.
    const resolved = resolveAgentBackend('claude', { ANTHROPIC_API_KEY: '  sk-ant-key-0123456789  ' })
    expect(resolved.credentialValue).toBe('sk-ant-key-0123456789')
  })

  test('every refusal surfaces a message carrying its code prefix', () => {
    // runCli's top-level catch prints only error.message, so the code rides the
    // message: the refusal cannot be misread as a config-parse or plan-path failure.
    const refusals: ReadonlyArray<Record<string, string | undefined>> = [
      { ANTHROPIC_API_KEY: 'a', CLAUDE_CODE_OAUTH_TOKEN: 'b' },
      {},
      { LLM_API_KEY: 'gateway-key' },
    ]
    for (const env of refusals) {
      const resolve = (): unknown => resolveAgentBackend('claude', env)
      expect(resolve).toThrow(BackendSelectionError)
      expect(resolve).toThrow(/\[CLAUDE_CREDENTIALS\]|\[LLM_CREDENTIALS\]/u)
    }
  })

  test('the opencode backend resolves without reading any credential', () => {
    const resolved = resolveAgentBackend('opencode', {})
    expect(resolved.profile).toBe('bare')
    expect(resolved.credentialName).toBe('ANTHROPIC_API_KEY')
    expect(resolved.credentialValue).toBe('')
  })
})
