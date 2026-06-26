// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AdminPluginConfigSnapshotSchema,
  SubmitAdminPluginConfigResponseSchema,
} from '../../../client/settings/fetcher-schemas-plugin-config.js'

describe('AdminPluginConfigSnapshotSchema', () => {
  test('parses a valid snapshot with plugins', () => {
    const parsed = AdminPluginConfigSnapshotSchema.parse({
      plugins: [
        {
          pluginId: 'my-plugin',
          keys: [{ key: 'api-key', label: 'API Key', value: 'secret', sensitive: true, required: true }],
        },
      ],
    })
    expect(parsed.plugins).toHaveLength(1)
    expect(parsed.plugins[0]!.pluginId).toBe('my-plugin')
    expect(parsed.plugins[0]!.keys[0]!.sensitive).toBe(true)
  })

  test('parses an empty plugins list', () => {
    const parsed = AdminPluginConfigSnapshotSchema.parse({ plugins: [] })
    expect(parsed.plugins).toHaveLength(0)
  })

  test('accepts null key value', () => {
    const parsed = AdminPluginConfigSnapshotSchema.parse({
      plugins: [{ pluginId: 'p', keys: [{ key: 'k', label: 'K', value: null, sensitive: false, required: false }] }],
    })
    expect(parsed.plugins[0]!.keys[0]!.value).toBeNull()
  })

  test('throws when plugins field is missing', () => {
    expect(() => AdminPluginConfigSnapshotSchema.parse({})).toThrow()
  })
})

describe('SubmitAdminPluginConfigResponseSchema', () => {
  test('parses a valid response', () => {
    const parsed = SubmitAdminPluginConfigResponseSchema.parse({
      ok: true,
      pluginId: 'my-plugin',
      key: 'api-key',
      updatedAt: 1700000000,
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.pluginId).toBe('my-plugin')
    expect(parsed.updatedAt).toBe(1700000000)
  })

  test('throws when ok is false', () => {
    expect(() =>
      SubmitAdminPluginConfigResponseSchema.parse({
        ok: false,
        pluginId: 'p',
        key: 'k',
        updatedAt: 0,
      }),
    ).toThrow()
  })

  test('throws when key is missing', () => {
    expect(() => SubmitAdminPluginConfigResponseSchema.parse({ ok: true, pluginId: 'p', updatedAt: 0 })).toThrow()
  })
})
