// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { inferProviderId } from '../../src/models-dev/provider-id.js'
import { assertEach, type Row } from '../utils/grouped-assertions.js'

type TypeRow = Row<{ readonly providerType: string; readonly expected: string }>

describe('inferProviderId', () => {
  test('typed provider ids map one-to-one onto catalogue providers', async () => {
    const rows: readonly TypeRow[] = [
      { label: 'openai maps to openai', providerType: 'openai', expected: 'openai' },
      { label: 'anthropic maps to anthropic', providerType: 'anthropic', expected: 'anthropic' },
      { label: 'google maps to google', providerType: 'google', expected: 'google' },
      { label: 'openrouter maps to openrouter', providerType: 'openrouter', expected: 'openrouter' },
      { label: 'groq maps to groq', providerType: 'groq', expected: 'groq' },
      { label: 'ollama maps to ollama', providerType: 'ollama', expected: 'ollama' },
    ]
    await assertEach(rows, (row) => {
      expect(inferProviderId({ providerType: row.providerType })).toBe(row.expected)
    })
  })

  test('custom gateway hosts map to catalogue providers', async () => {
    const rows: readonly TypeRow[] = [
      {
        label: 'openrouter.ai maps to openrouter',
        providerType: 'https://openrouter.ai/api/v1',
        expected: 'openrouter',
      },
      { label: 'api.openai.com maps to openai', providerType: 'https://api.openai.com/v1', expected: 'openai' },
      {
        label: 'api.anthropic.com maps to anthropic',
        providerType: 'https://api.anthropic.com',
        expected: 'anthropic',
      },
      {
        label: 'generativelanguage.googleapis.com maps to google',
        providerType: 'https://generativelanguage.googleapis.com/v1beta',
        expected: 'google',
      },
      { label: 'api.groq.com maps to groq', providerType: 'https://api.groq.com/openai/v1', expected: 'groq' },
    ]
    await assertEach(rows, (row) => {
      expect(inferProviderId({ baseUrl: row.providerType })).toBe(row.expected)
    })
  })

  test('typed provider identity wins over the baseUrl host', () => {
    expect(inferProviderId({ providerType: 'anthropic', baseUrl: 'https://openrouter.ai/api/v1' })).toBe('anthropic')
  })

  test('a missing type still infers from the baseUrl host', () => {
    expect(inferProviderId({ baseUrl: 'https://openrouter.ai/api/v1' })).toBe('openrouter')
  })

  test('an unknown type still infers from the baseUrl host', () => {
    expect(inferProviderId({ providerType: 'weird', baseUrl: 'https://api.openai.com/v1' })).toBe('openai')
  })

  test('host matching is case-insensitive', () => {
    expect(inferProviderId({ baseUrl: 'https://API.OPENAI.COM/v1' })).toBe('openai')
  })

  test('unknown hosts resolve to null', () => {
    expect(inferProviderId({ providerType: 'custom', baseUrl: 'https://gateway.example.com/v1' })).toBeNull()
  })

  test('absent or empty inputs resolve to null', () => {
    expect(inferProviderId({})).toBeNull()
    expect(inferProviderId({ providerType: null, baseUrl: null })).toBeNull()
    expect(inferProviderId({ providerType: '', baseUrl: '' })).toBeNull()
    expect(inferProviderId({ providerType: 'custom' })).toBeNull()
    expect(inferProviderId({ providerType: 'custom', baseUrl: '' })).toBeNull()
  })

  test('unparseable base urls degrade to null', () => {
    expect(inferProviderId({ providerType: 'custom', baseUrl: 'not a url' })).toBeNull()
  })
})
