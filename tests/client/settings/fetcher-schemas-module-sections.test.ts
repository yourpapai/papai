// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { z } from 'zod'

import { ModuleSectionsResponseSchema } from '../../../client/settings/fetcher-schemas-module-sections.js'

type ModuleSectionsPayload = z.input<typeof ModuleSectionsResponseSchema>

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

  test('parses a legacy field/section with no new keys (backward-compatible)', () => {
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
          ],
        },
      ],
    }
    expect(ModuleSectionsResponseSchema.parse(payload)).toEqual(payload)
  })

  test('parses a field with control: readonly-derived', () => {
    const payload: ModuleSectionsPayload = {
      sections: [
        {
          id: 'acp',
          label: 'ACP',
          fields: [
            {
              key: 'derived_status',
              label: 'Status',
              value: 'connected',
              sensitive: false,
              required: false,
              control: 'readonly-derived',
            },
          ],
        },
      ],
    }
    expect(ModuleSectionsResponseSchema.parse(payload)).toEqual(payload)
  })

  test('parses a field with control: action-button and actionId', () => {
    const payload: ModuleSectionsPayload = {
      sections: [
        {
          id: 'acp',
          label: 'ACP',
          fields: [
            {
              key: 'reconnect',
              label: 'Reconnect',
              value: null,
              sensitive: false,
              required: false,
              control: 'action-button',
              actionId: 'reconnect-magi',
            },
          ],
        },
      ],
    }
    expect(ModuleSectionsResponseSchema.parse(payload)).toEqual(payload)
  })

  test('parses a field with control: select and options', () => {
    const payload: ModuleSectionsPayload = {
      sections: [
        {
          id: 'acp',
          label: 'ACP',
          fields: [
            {
              key: 'mode',
              label: 'Mode',
              value: 'fast',
              sensitive: false,
              required: false,
              control: 'select',
              options: [
                { value: 'fast', label: 'Fast' },
                { value: 'thorough', label: 'Thorough' },
              ],
            },
          ],
        },
      ],
    }
    expect(ModuleSectionsResponseSchema.parse(payload)).toEqual(payload)
  })

  test('parses a section with scope: context and actions', () => {
    const payload: ModuleSectionsPayload = {
      sections: [
        {
          id: 'acp',
          label: 'ACP',
          scope: 'context',
          actions: [
            {
              id: 'reconnect-magi',
              label: 'Reconnect',
              route: '/settings/api/admin/module-sections/reconnect',
              method: 'POST',
            },
          ],
          fields: [{ key: 'magi_base_url', label: 'Magi base URL', value: null, sensitive: false, required: true }],
        },
      ],
    }
    expect(ModuleSectionsResponseSchema.parse(payload)).toEqual(payload)
  })
})
