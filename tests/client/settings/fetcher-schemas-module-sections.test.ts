// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ModuleSectionsResponseSchema } from '../../../client/settings/fetcher-schemas-module-sections.js'

describe('fetcher-schemas-module-sections', () => {
  test('parses a realistic module-sections response', () => {
    const payload = {
      sections: [
        {
          id: 'acp',
          label: 'ACP',
          fields: [
            {
              key: 'magi_base_url',
              label: 'Magi base URL',
              value: 'https://magi.example.com',
              sensitive: false,
              required: true,
            },
            { key: 'magi_token', label: 'Magi token', value: '****abcd', sensitive: true, required: true },
          ],
        },
      ],
    }
    expect(ModuleSectionsResponseSchema.parse(payload)).toEqual(payload)
  })

  test('rejects a section missing required fields', () => {
    expect(() => ModuleSectionsResponseSchema.parse({ sections: [{ id: 'acp' }] })).toThrow()
  })
})
