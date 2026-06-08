// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { AdminByokResponseSchema, ByokResponseSchema } from '../../../client/settings/fetcher-schemas.js'

describe('BYOK fetcher schemas', () => {
  test('parses context BYOK response', () => {
    const parsed = ByokResponseSchema.parse({
      enabled: true,
      complete: false,
      missing: ['llm_apikey'],
      fields: [
        {
          key: 'llm_apikey',
          label: 'LLM API Key',
          required: true,
          sensitive: true,
          hasValue: false,
          value: '',
        },
      ],
    })

    expect(parsed.enabled).toBe(true)
    expect(parsed.fields[0]?.sensitive).toBe(true)
  })

  test('parses admin BYOK summaries', () => {
    const parsed = AdminByokResponseSchema.parse({
      contexts: [
        {
          contextId: 'ctx-1',
          enabled: true,
          complete: true,
          missing: [],
          updatedAt: 1,
          updatedBy: 'admin',
        },
      ],
    })

    expect(parsed.contexts[0]?.contextId).toBe('ctx-1')
    expect(parsed.contexts[0]?.updatedBy).toBe('admin')
  })

  test('preserves admin BYOK unreadable credential metadata', () => {
    const parsed = AdminByokResponseSchema.parse({
      contexts: [
        {
          contextId: 'ctx-bad',
          enabled: true,
          complete: false,
          missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
          updatedAt: 2,
          updatedBy: 'admin',
          unreadable: true,
          error: 'stored BYOK LLM credentials are unreadable',
        },
      ],
    })

    expect(parsed.contexts[0]?.unreadable).toBe(true)
    expect(parsed.contexts[0]?.error).toBe('stored BYOK LLM credentials are unreadable')
  })
})
