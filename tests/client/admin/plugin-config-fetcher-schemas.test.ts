// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AdminPluginConfigSnapshotSchema,
  SubmitAdminPluginConfigResponseSchema,
} from '../../../client/admin/plugin-config-fetcher-schemas.js'

describe('AdminPluginConfigSnapshotSchema', () => {
  test('parses empty plugins array', () => {
    const result = AdminPluginConfigSnapshotSchema.safeParse({ plugins: [] })
    expect(result.success).toBe(true)
  })

  test('parses plugin with config keys', () => {
    const result = AdminPluginConfigSnapshotSchema.parse({
      plugins: [
        {
          pluginId: 'hello-world',
          keys: [
            { key: 'apiKey', label: 'API Key', value: null, sensitive: true, required: true },
            { key: 'baseUrl', label: 'Base URL', value: 'https://api.example.com', sensitive: false, required: false },
          ],
        },
      ],
    })
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]?.keys).toHaveLength(2)
  })

  test('rejects missing required fields', () => {
    const result = AdminPluginConfigSnapshotSchema.safeParse({
      plugins: [{ pluginId: 'test' }],
    })
    expect(result.success).toBe(false)
  })

  test('rejects invalid key shape', () => {
    const result = AdminPluginConfigSnapshotSchema.safeParse({
      plugins: [
        {
          pluginId: 'test',
          keys: [{ key: 'foo' }],
        },
      ],
    })
    expect(result.success).toBe(false)
  })
})

describe('SubmitAdminPluginConfigResponseSchema', () => {
  test('parses valid response', () => {
    const result = SubmitAdminPluginConfigResponseSchema.safeParse({
      ok: true,
      pluginId: 'hello-world',
      key: 'apiKey',
      updatedAt: 1716800000000,
    })
    expect(result.success).toBe(true)
  })

  test('rejects ok: false', () => {
    const result = SubmitAdminPluginConfigResponseSchema.safeParse({
      ok: false,
      pluginId: 'test',
      key: 'key',
      updatedAt: 0,
    })
    expect(result.success).toBe(false)
  })

  test('rejects missing fields', () => {
    const result = SubmitAdminPluginConfigResponseSchema.safeParse({ ok: true })
    expect(result.success).toBe(false)
  })
})
