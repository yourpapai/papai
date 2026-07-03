// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { StoredConfigValueSchema } from '../../../client/settings/fetcher-schemas-shared.js'

describe('StoredConfigValueSchema', () => {
  test('parses a minimal stored config value', () => {
    const parsed = StoredConfigValueSchema.parse({
      key: 'llm_apikey',
      label: 'LLM API Key',
      required: true,
      sensitive: true,
      hasValue: false,
      value: '',
    })

    expect(parsed.key).toBe('llm_apikey')
    expect(parsed.control).toBeUndefined()
    expect(parsed.options).toBeUndefined()
  })

  test('parses optional control and options fields', () => {
    const parsed = StoredConfigValueSchema.parse({
      key: 'provider_type',
      label: 'Provider Type',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'kaneo',
      control: 'select',
      options: ['kaneo', 'youtrack'],
    })

    expect(parsed.control).toBe('select')
    expect(parsed.options).toEqual(['kaneo', 'youtrack'])
  })

  test('rejects an invalid control value', () => {
    expect(() =>
      StoredConfigValueSchema.parse({
        key: 'k',
        label: 'l',
        required: true,
        sensitive: false,
        hasValue: false,
        value: '',
        control: 'invalid',
      }),
    ).toThrow()
  })
})
