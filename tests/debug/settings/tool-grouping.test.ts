// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  activePluginSegmentMap,
  deriveToolGroup,
  resolveGroupTools,
} from '../../../src/debug/settings/tool-grouping.js'
import { pluginRegistry } from '../../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

const PLUGIN_ID = 'audio-transcribe'

function makeDiscoveredPlugin(id: string): DiscoveredPlugin {
  return {
    manifest: {
      id,
      name: `Plugin ${id}`,
      version: '1.0.0',
      description: 'Test plugin',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
        attachmentTransformers: [],
      },
      permissions: [],
      defaultEnabled: false,
      activationTimeoutMs: 5000,
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [],
      providerCapabilities: [],
      providerTraits: [],
      providerConfigSchema: [],
      providerContextConfigSchema: [],
      providerAllowedHosts: [],
    },
    pluginDir: `/tmp/${id}`,
    entryPoint: `/tmp/${id}/index.ts`,
    manifestHash: `hash-${id}`,
  }
}

describe('tool-grouping', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    pluginRegistry.clearForTesting()
  })

  afterEach(() => {
    pluginRegistry.clearForTesting()
  })

  test('deriveToolGroup returns undefined for builtin names', () => {
    expect(deriveToolGroup('create_task', new Map())).toBeUndefined()
    expect(deriveToolGroup('web_fetch', new Map())).toBeUndefined()
  })

  test('deriveToolGroup extracts the mcp server segment', () => {
    expect(deriveToolGroup('mcp_search-server__fetch_page', new Map())).toBe('search-server')
  })

  test('deriveToolGroup splits at the FIRST double underscore', () => {
    expect(deriveToolGroup('mcp_srv__tool__with__underscores', new Map())).toBe('srv')
  })

  test('deriveToolGroup maps sanitized plugin segments back to the real plugin id', () => {
    const segments = new Map([
      ['audio_transcribe', 'audio-transcribe'],
      ['audio-transcribe', 'audio-transcribe'],
    ])
    // native plugin tool naming (sanitizePluginId: '-' → '_')
    expect(deriveToolGroup('plugin_audio_transcribe__transcribe', segments)).toBe('audio-transcribe')
    // plugin-declared MCP tool naming (sanitizeServerId: kebab-case)
    expect(deriveToolGroup('plugin_audio-transcribe__remote_tool', segments)).toBe('audio-transcribe')
  })

  test('deriveToolGroup falls back to the raw segment for unknown plugins', () => {
    expect(deriveToolGroup('plugin_unknown_seg__t', new Map())).toBe('unknown_seg')
  })

  test('activePluginSegmentMap contains both sanitized forms of each active plugin id', () => {
    pluginRegistry.registerDiscovered(makeDiscoveredPlugin(PLUGIN_ID))
    pluginRegistry.markActive(PLUGIN_ID)
    const map = activePluginSegmentMap()
    expect(map.get('audio_transcribe')).toBe(PLUGIN_ID)
    expect(map.get('audio-transcribe')).toBe(PLUGIN_ID)
  })

  test('resolveGroupTools filters names by domain and derived group', () => {
    pluginRegistry.registerDiscovered(makeDiscoveredPlugin(PLUGIN_ID))
    pluginRegistry.markActive(PLUGIN_ID)
    const names = [
      'create_task',
      'plugin_audio_transcribe__transcribe',
      'plugin_audio_transcribe__list_jobs',
      'plugin_other__t',
      'mcp_srv__fetch',
    ]
    expect(resolveGroupTools(names, 'plugin', 'audio-transcribe')).toEqual([
      'plugin_audio_transcribe__transcribe',
      'plugin_audio_transcribe__list_jobs',
    ])
    expect(resolveGroupTools(names, 'mcp', 'srv')).toEqual(['mcp_srv__fetch'])
    expect(resolveGroupTools(names, 'plugin', 'nope')).toEqual([])
  })
})
