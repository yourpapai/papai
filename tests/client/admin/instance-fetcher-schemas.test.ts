// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  ApplyInstancesResultSchema,
  PlatformProviderTypeViewSchema,
  TaskInstanceViewSchema,
  TaskProviderTypeViewSchema,
} from '../../../client/admin/instance-fetcher-schemas.js'

describe('ApplyInstancesResultSchema', () => {
  test('ApplyInstancesResultSchema accepts detailed reconciliation result', () => {
    const result = ApplyInstancesResultSchema.safeParse({
      applied: 2,
      started: ['telegram-main'],
      stopped: ['discord-old'],
      removed: ['discord-old'],
      recreated: ['mattermost-main'],
      unchanged: ['telegram-secondary'],
      failed: [{ id: 'telegram-bad', action: 'stop', error: 'boom' }],
    })

    expect(result.success).toBe(true)
  })
})

describe('TaskInstanceViewSchema', () => {
  test('accepts any string type after the enum was opened', () => {
    const result = TaskInstanceViewSchema.safeParse({
      id: 'custom-1',
      type: 'custom-provider',
      config: {},
      status: 'active',
      createdAt: '2026-05-26T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  test('still accepts known types', () => {
    const result = TaskInstanceViewSchema.safeParse({
      id: 'kaneo-main',
      type: 'kaneo',
      config: {},
      status: 'pending',
      createdAt: '2026-05-26T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })
})

describe('TaskProviderTypeViewSchema', () => {
  test('parses a builtin provider type entry', () => {
    const parsed = TaskProviderTypeViewSchema.parse({
      type: 'kaneo',
      displayName: 'Kaneo',
      instanceConfigSchema: [{ key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false }],
      contextConfigSchema: [
        {
          key: 'credential',
          label: 'Kaneo API key',
          required: true,
          sensitive: true,
          storageKey: 'kaneo_apikey',
        },
      ],
      capabilities: ['comments.read'],
      traits: ['workspace-scoped'],
      source: 'builtin',
    })
    expect(parsed.type).toBe('kaneo')
    expect(parsed.instanceConfigSchema[0]?.key).toBe('baseUrl')
    expect(parsed.contextConfigSchema[0]?.storageKey).toBe('kaneo_apikey')
    expect(parsed.traits).toContain('workspace-scoped')
    expect(parsed.source).toBe('builtin')
  })

  test('parses a plugin-sourced provider type entry', () => {
    const parsed = TaskProviderTypeViewSchema.parse({
      type: 'custom-tracker',
      displayName: 'Custom Tracker',
      instanceConfigSchema: [],
      contextConfigSchema: [],
      capabilities: [],
      traits: [],
      source: { plugin: 'my-plugin' },
    })
    expect(parsed.source).toEqual({ plugin: 'my-plugin' })
  })

  test('rejects missing required fields', () => {
    const result = TaskProviderTypeViewSchema.safeParse({ type: 'kaneo' })
    expect(result.success).toBe(false)
  })

  test('rejects invalid source shape', () => {
    const result = TaskProviderTypeViewSchema.safeParse({
      type: 'kaneo',
      displayName: 'Kaneo',
      instanceConfigSchema: [],
      contextConfigSchema: [],
      capabilities: [],
      traits: [],
      source: 42,
    })
    expect(result.success).toBe(false)
  })

  test('rejects plugin source with empty plugin id', () => {
    const result = TaskProviderTypeViewSchema.safeParse({
      type: 'custom-tracker',
      displayName: 'Custom Tracker',
      instanceConfigSchema: [],
      contextConfigSchema: [],
      capabilities: [],
      traits: [],
      source: { plugin: '' },
    })
    expect(result.success).toBe(false)
  })
})

describe('PlatformProviderTypeViewSchema', () => {
  test('parses structured chat provider traits', () => {
    const parsed = PlatformProviderTypeViewSchema.parse({
      type: 'mattermost',
      displayName: 'Mattermost',
      instanceConfigSchema: [{ key: 'baseUrl', label: 'Mattermost URL', required: true, sensitive: false }],
      contextConfigSchema: [],
      capabilities: ['commands'],
      traits: { observedGroupMessages: 'all', maxMessageLength: 16383 },
      source: 'builtin',
    })

    expect(parsed.traits.observedGroupMessages).toBe('all')
    expect(parsed.traits.maxMessageLength).toBe(16383)
  })

  test('accepts kontur-talk type', () => {
    const parsed = PlatformProviderTypeViewSchema.parse({
      type: 'kontur-talk',
      displayName: 'Kontur Talk',
      instanceConfigSchema: [{ key: 'jwtToken', label: 'JWT Token', required: true, sensitive: true }],
      contextConfigSchema: [],
      capabilities: ['messages.reply-context'],
      traits: { observedGroupMessages: 'all', maxMessageLength: 4096 },
      source: 'builtin',
    })

    expect(parsed.type).toBe('kontur-talk')
  })

  test('rejects legacy array traits', () => {
    const result = PlatformProviderTypeViewSchema.safeParse({
      type: 'mattermost',
      displayName: 'Mattermost',
      instanceConfigSchema: [],
      contextConfigSchema: [],
      capabilities: [],
      traits: [],
      source: 'builtin',
    })

    expect(result.success).toBe(false)
  })
})
