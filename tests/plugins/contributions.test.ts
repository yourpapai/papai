// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  MAX_FRAGMENT_LENGTH_PER_PLUGIN,
  MAX_TOTAL_PLUGIN_PROMPT_LENGTH,
  buildPluginPromptSection,
  buildPluginToolSet,
  contributionRegistry,
  namespacedToolName,
  sanitizePluginId,
} from '../../src/plugins/contributions.js'
import type { PluginContributions, PluginManifest } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    apiVersion: 1,
    main: 'index.ts',
    contributes: { tools: ['my_tool'], promptFragments: ['hint'], commands: [], jobs: [], configKeys: [] },
    permissions: [],
    defaultEnabled: false,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    ...overrides,
  }
}

describe('sanitizePluginId', () => {
  test('replaces hyphens with underscores', () => {
    expect(sanitizePluginId('my-plugin')).toBe('my_plugin')
    expect(sanitizePluginId('a-b-c')).toBe('a_b_c')
  })

  test('leaves non-hyphen characters unchanged', () => {
    expect(sanitizePluginId('myplugin')).toBe('myplugin')
    expect(sanitizePluginId('plugin123')).toBe('plugin123')
  })
})

describe('namespacedToolName', () => {
  test('namespaces correctly', () => {
    expect(namespacedToolName('my-plugin', 'my_tool')).toBe('plugin_my_plugin__my_tool')
  })

  test('handles no-hyphen plugin IDs', () => {
    expect(namespacedToolName('myplugin', 'search')).toBe('plugin_myplugin__search')
  })
})

describe('PluginContributionRegistry', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    contributionRegistry.deregister('test-plugin')
    contributionRegistry.deregister('other-plugin')
  })

  afterEach(() => {
    contributionRegistry.deregister('test-plugin')
    contributionRegistry.deregister('other-plugin')
  })

  test('registers and retrieves contributions', () => {
    const manifest = makeManifest()
    const contributions: PluginContributions = {
      tools: [{ name: 'my_tool', description: 'A test tool', execute: () => Promise.resolve<unknown>('ok') }],
      promptFragments: [{ name: 'hint', content: 'Use this hint' }],
    }
    contributionRegistry.register('test-plugin', contributions, manifest)
    const result = contributionRegistry.getContributions('test-plugin')
    expect(result).toBeDefined()
    expect(result?.tools).toHaveLength(1)
    expect(result?.promptFragments).toHaveLength(1)
  })

  test('filters out undeclared tools', () => {
    const manifest = makeManifest({
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [] },
    })
    const contributions: PluginContributions = {
      tools: [{ name: 'undeclared_tool', description: 'Not in manifest', execute: () => Promise.resolve<unknown>('') }],
      promptFragments: [],
    }
    contributionRegistry.register('test-plugin', contributions, manifest)
    const result = contributionRegistry.getContributions('test-plugin')
    expect(result?.tools).toHaveLength(0)
  })

  test('filters out undeclared prompt fragments', () => {
    const manifest = makeManifest({
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [] },
    })
    const contributions: PluginContributions = {
      tools: [],
      promptFragments: [{ name: 'undeclared', content: 'nope' }],
    }
    contributionRegistry.register('test-plugin', contributions, manifest)
    const result = contributionRegistry.getContributions('test-plugin')
    expect(result?.promptFragments).toHaveLength(0)
  })

  test('deregister removes contributions', () => {
    const manifest = makeManifest()
    contributionRegistry.register('test-plugin', { tools: [], promptFragments: [] }, manifest)
    contributionRegistry.deregister('test-plugin')
    expect(contributionRegistry.getContributions('test-plugin')).toBeUndefined()
  })
})

describe('buildPluginToolSet', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    contributionRegistry.deregister('test-plugin')
  })

  afterEach(() => {
    contributionRegistry.deregister('test-plugin')
  })

  test('returns empty ToolSet when no plugins active', () => {
    const tools = buildPluginToolSet([], new Set())
    expect(Object.keys(tools)).toHaveLength(0)
  })

  test('wraps and namespaces plugin tools', () => {
    const manifest = makeManifest()
    contributionRegistry.register(
      'test-plugin',
      {
        tools: [
          { name: 'my_tool', description: 'A test tool', execute: (): Promise<unknown> => Promise.resolve('ok') },
        ],
        promptFragments: [],
      },
      manifest,
    )
    const tools = buildPluginToolSet(['test-plugin'], new Set())
    expect(Object.keys(tools)).toContain('plugin_test_plugin__my_tool')
  })

  test('skips tools that collide with existing tool names', () => {
    const manifest = makeManifest()
    contributionRegistry.register(
      'test-plugin',
      {
        tools: [
          { name: 'my_tool', description: 'A test tool', execute: (): Promise<unknown> => Promise.resolve('ok') },
        ],
        promptFragments: [],
      },
      manifest,
    )
    const existing = new Set(['plugin_test_plugin__my_tool'])
    const tools = buildPluginToolSet(['test-plugin'], existing)
    expect(Object.keys(tools)).toHaveLength(0)
  })
})

describe('buildPluginPromptSection', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    contributionRegistry.deregister('test-plugin')
  })

  afterEach(() => {
    contributionRegistry.deregister('test-plugin')
  })

  test('returns empty string when no active plugins', () => {
    expect(buildPluginPromptSection([])).toBe('')
  })

  test('wraps fragment in plugin delimiters', () => {
    const manifest = makeManifest()
    contributionRegistry.register(
      'test-plugin',
      { tools: [], promptFragments: [{ name: 'hint', content: 'Hello from plugin!' }] },
      manifest,
    )
    const section = buildPluginPromptSection(['test-plugin'])
    expect(section).toContain('<!-- plugin:test-plugin:hint -->')
    expect(section).toContain('Hello from plugin!')
    expect(section).toContain('<!-- /plugin:test-plugin:hint -->')
  })

  test('calls function-based content at render time', () => {
    const manifest = makeManifest()
    let called = false
    contributionRegistry.register(
      'test-plugin',
      {
        tools: [],
        promptFragments: [
          {
            name: 'hint',
            content: (): string => {
              called = true
              return 'dynamic!'
            },
          },
        ],
      },
      manifest,
    )
    buildPluginPromptSection(['test-plugin'])
    expect(called).toBe(true)
  })

  test('truncates fragment exceeding per-plugin limit', () => {
    const manifest = makeManifest()
    const longContent = 'x'.repeat(MAX_FRAGMENT_LENGTH_PER_PLUGIN + 100)
    contributionRegistry.register(
      'test-plugin',
      { tools: [], promptFragments: [{ name: 'hint', content: longContent }] },
      manifest,
    )
    const section = buildPluginPromptSection(['test-plugin'])
    expect(section.length).toBeLessThan(MAX_TOTAL_PLUGIN_PROMPT_LENGTH)
  })
})
