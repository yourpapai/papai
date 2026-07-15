// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AdminLlmRolesResponseSchema,
  AdminProvidersResponseSchema,
  PROVIDER_TYPE_BASE_URLS,
  PublicProviderAccountSchema,
  VerificationSchema,
} from '../../../client/settings/fetcher-schemas-llm-providers.js'

describe('LLM provider schemas', () => {
  test('parses a public provider account', () => {
    const parsed = PublicProviderAccountSchema.parse({
      id: 'prov_1',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '****abcd',
      verification: {
        status: 'verified',
        error: null,
        at: 1717000000000,
        models: ['gpt-4o'],
        modelsFetchedAt: 1717000000000,
      },
    })

    expect(parsed.id).toBe('prov_1')
    expect(parsed.verification.status).toBe('verified')
    expect(parsed.verification.models).toEqual(['gpt-4o'])
  })

  test('rejects an unknown provider type', () => {
    expect(() =>
      PublicProviderAccountSchema.parse({
        id: 'prov_1',
        label: 'X',
        providerType: 'unknown',
        baseUrl: 'x',
        apiKeyMasked: '****x',
        verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
      }),
    ).toThrow()
  })

  test('parses admin providers list response', () => {
    const parsed = AdminProvidersResponseSchema.parse({
      providers: [
        {
          id: 'prov_1',
          label: 'OpenAI',
          providerType: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyMasked: '****abcd',
          verification: { status: 'verified', error: null, at: null, models: [], modelsFetchedAt: null },
        },
      ],
    })
    expect(parsed.providers).toHaveLength(1)
  })

  test('parses admin roles response', () => {
    const parsed = AdminLlmRolesResponseSchema.parse({
      roles: {
        main: { providerId: 'prov_1', model: 'gpt-4o' },
        small: null,
        embedding: null,
      },
    })
    expect(parsed.roles.main.model).toBe('gpt-4o')
    expect(parsed.roles.small).toBeNull()
  })

  test('PROVIDER_TYPE_BASE_URLS has presets for known types', () => {
    expect(PROVIDER_TYPE_BASE_URLS.openai).toBe('https://api.openai.com/v1')
    expect(PROVIDER_TYPE_BASE_URLS.ollama).toBe('http://localhost:11434/v1')
  })

  test('VerificationSchema accepts error status with message', () => {
    const parsed = VerificationSchema.parse({
      status: 'error',
      error: 'boom',
      at: 1,
      models: [],
      modelsFetchedAt: null,
    })
    expect(parsed.status).toBe('error')
    expect(parsed.error).toBe('boom')
  })
})
