// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { pluginManifestSchema } from '../../../src/plugins/types.js'

describe('task-provider-kaneo manifest', () => {
  const raw: unknown = JSON.parse(
    readFileSync(join(__dirname, '../../../plugins/task-provider-kaneo/plugin.json'), 'utf8'),
  )

  test('parses against pluginManifestSchema', () => {
    expect(pluginManifestSchema.safeParse(raw).success).toBe(true)
  })
  test('declares the kaneo task provider type with provider.task + identity permissions', () => {
    const manifest = pluginManifestSchema.parse(raw)
    expect(manifest.contributes.taskProviderTypes).toEqual(['kaneo'])
    expect(manifest.permissions).toContain('provider.task')
    expect(manifest.permissions).toContain('identity')
  })
  test('declares instance-scoped baseUrl and internalUrl', () => {
    const manifest = pluginManifestSchema.parse(raw)
    const keys = manifest.providerConfigSchema.map((field) => field.key)
    expect(keys).toContain('baseUrl')
    expect(keys).toContain('internalUrl')
  })
  test('authored manifest declares no storageKey (context keys are namespaced)', () => {
    const text = readFileSync(join(__dirname, '../../../plugins/task-provider-kaneo/plugin.json'), 'utf8')
    expect(text).not.toContain('storageKey')
    // still confirm the context fields exist & are shaped right (via parsed view)
    const manifest = pluginManifestSchema.parse(raw)
    const credential = manifest.providerContextConfigSchema.find((f) => f.key === 'credential')
    expect(credential).toMatchObject({ scope: 'context', sensitive: true })
    const workspace = manifest.providerContextConfigSchema.find((f) => f.key === 'workspaceId')
    expect(workspace).toMatchObject({ scope: 'context' })
  })
})
