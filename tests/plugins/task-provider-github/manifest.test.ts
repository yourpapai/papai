// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { pluginManifestSchema } from '../../../src/plugins/types.js'

describe('task-provider-github manifest', () => {
  const raw: unknown = JSON.parse(
    readFileSync(join(__dirname, '../../../plugins/task-provider-github/plugin.json'), 'utf8'),
  )

  test('parses against pluginManifestSchema', () => {
    expect(pluginManifestSchema.safeParse(raw).success).toBe(true)
  })
  test('declares id, apiVersion, main, and defaultEnabled', () => {
    const manifest = pluginManifestSchema.parse(raw)
    expect(manifest.id).toBe('task-provider-github')
    expect(manifest.apiVersion).toBe(1)
    expect(manifest.main).toBe('index.ts')
    expect(manifest.defaultEnabled).toBe(false)
  })
  test('declares exactly the provider.task + identity permissions and the github task provider type', () => {
    const manifest = pluginManifestSchema.parse(raw)
    expect(manifest.permissions).toEqual(['provider.task', 'identity'])
    expect(manifest.contributes.taskProviderTypes).toEqual(['github'])
  })
  test('declares exactly the eleven session-1 + comment/label capabilities', () => {
    const manifest = pluginManifestSchema.parse(raw)
    expect(manifest.providerCapabilities).toEqual([
      'projects.list',
      'projects.read',
      'comments.read',
      'comments.create',
      'comments.update',
      'comments.delete',
      'labels.list',
      'labels.create',
      'labels.update',
      'labels.delete',
      'labels.assign',
    ])
  })
  test('declares instance-scoped repo (required) and baseUrl (optional)', () => {
    const manifest = pluginManifestSchema.parse(raw)
    const repo = manifest.providerConfigSchema.find((field) => field.key === 'repo')
    expect(repo).toMatchObject({ scope: 'instance', required: true })
    const baseUrl = manifest.providerConfigSchema.find((field) => field.key === 'baseUrl')
    expect(baseUrl).toMatchObject({ scope: 'instance', required: false })
  })
  test('declares a context-scoped, required, sensitive token', () => {
    const manifest = pluginManifestSchema.parse(raw)
    const token = manifest.providerContextConfigSchema.find((field) => field.key === 'token')
    expect(token).toMatchObject({ scope: 'context', required: true, sensitive: true })
  })
  test('pins api.github.com and derives allowed instance hosts from baseUrl', () => {
    const manifest = pluginManifestSchema.parse(raw)
    expect(manifest.providerAllowedHosts).toEqual(['api.github.com'])
    expect(manifest.providerAllowedInstanceHostsFromConfig).toEqual(['baseUrl'])
  })
  test('names validateConfig as the provider config validator', () => {
    const manifest = pluginManifestSchema.parse(raw)
    expect(manifest.providerConfigValidator).toBe('validateConfig')
  })
})
