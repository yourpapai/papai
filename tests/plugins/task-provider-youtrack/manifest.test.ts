// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { pluginManifestSchema } from '../../../src/plugins/types.js'

describe('task-provider-youtrack manifest', () => {
  const raw: unknown = JSON.parse(
    readFileSync(join(__dirname, '../../../plugins/task-provider-youtrack/plugin.json'), 'utf8'),
  )

  test('parses against pluginManifestSchema', () => {
    expect(pluginManifestSchema.safeParse(raw).success).toBe(true)
  })
  test('declares the youtrack task provider type with provider.task + identity permissions', () => {
    const manifest = pluginManifestSchema.parse(raw)
    expect(manifest.contributes.taskProviderTypes).toEqual(['youtrack'])
    expect(manifest.permissions).toContain('provider.task')
    expect(manifest.permissions).toContain('identity')
  })
  test('providerConfigSchema (instance) contains baseUrl', () => {
    const manifest = pluginManifestSchema.parse(raw)
    const keys = manifest.providerConfigSchema.map((field) => field.key)
    expect(keys).toContain('baseUrl')
  })
  test('providerContextConfigSchema (context) contains token', () => {
    const manifest = pluginManifestSchema.parse(raw)
    const keys = manifest.providerContextConfigSchema.map((field) => field.key)
    expect(keys).toContain('token')
  })
  test('authored manifest declares no storageKey (context keys are namespaced)', () => {
    const text = readFileSync(join(__dirname, '../../../plugins/task-provider-youtrack/plugin.json'), 'utf8')
    expect(text).not.toContain('storageKey')
    // still confirm the context token field is shaped right (via parsed view)
    const manifest = pluginManifestSchema.parse(raw)
    const token = manifest.providerContextConfigSchema.find((f) => f.key === 'token')
    expect(token).toMatchObject({ scope: 'context', sensitive: true })
  })
})
