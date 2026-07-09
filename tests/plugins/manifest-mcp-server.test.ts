// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { pluginManifestSchema } from '../../src/plugins/types.js'

const BASE = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  description: 'demo plugin',
  apiVersion: 1,
  main: 'index.ts',
}

describe('mcpServer manifest flag', () => {
  test('defaults to false when omitted', () => {
    const parsed = pluginManifestSchema.parse(BASE)
    expect(parsed.mcpServer).toBe(false)
  })

  test('accepts an explicit true', () => {
    const parsed = pluginManifestSchema.parse({ ...BASE, mcpServer: true })
    expect(parsed.mcpServer).toBe(true)
  })

  test('rejects a non-boolean', () => {
    expect(pluginManifestSchema.safeParse({ ...BASE, mcpServer: 'yes' }).success).toBe(false)
  })
})
