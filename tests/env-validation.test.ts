import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { validateChatProviderEnv } from '../src/env-validation.js'

describe('validateChatProviderEnv', () => {
  test('accepts telegram with TELEGRAM_BOT_TOKEN', () => {
    const result = validateChatProviderEnv('telegram', { TELEGRAM_BOT_TOKEN: 'tok' })
    expect(result.ok).toBe(true)
  })

  test('accepts mattermost with MATTERMOST_URL and MATTERMOST_BOT_TOKEN', () => {
    const result = validateChatProviderEnv('mattermost', {
      MATTERMOST_URL: 'https://mm.example.com',
      MATTERMOST_BOT_TOKEN: 'tok',
    })
    expect(result.ok).toBe(true)
  })

  test('accepts discord with DISCORD_BOT_TOKEN', () => {
    const result = validateChatProviderEnv('discord', { DISCORD_BOT_TOKEN: 'tok' })
    expect(result.ok).toBe(true)
  })

  test('rejects discord when DISCORD_BOT_TOKEN is missing', () => {
    const result = validateChatProviderEnv('discord', {})
    assert(!result.ok)
    expect(result.missing).toContain('DISCORD_BOT_TOKEN')
  })

  test('rejects unknown provider', () => {
    const result = validateChatProviderEnv('unknown', {})
    assert(!result.ok)
    expect(result.reason).toContain('CHAT_PROVIDER must be')
  })
})
