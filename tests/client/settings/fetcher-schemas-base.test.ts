// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { StoredConfigValueSchema } from '../../../client/settings/fetcher-schemas-base.js'

describe('fetcher-schemas-base', () => {
  test('StoredConfigValueSchema parses a valid config value', () => {
    const parsed = StoredConfigValueSchema.parse({
      key: 'timezone',
      label: 'Timezone',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'UTC',
    })
    expect(parsed.key).toBe('timezone')
    expect(parsed.hasValue).toBe(true)
    expect(parsed.value).toBe('UTC')
  })

  test('StoredConfigValueSchema rejects missing required fields', () => {
    expect(() => StoredConfigValueSchema.parse({ key: 'k', label: 'L' })).toThrow()
  })

  test('StoredConfigValueSchema accepts empty string value', () => {
    const parsed = StoredConfigValueSchema.parse({
      key: 'k',
      label: 'L',
      required: false,
      sensitive: false,
      hasValue: false,
      value: '',
    })
    expect(parsed.value).toBe('')
  })
})
