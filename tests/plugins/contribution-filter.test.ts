// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  getValidAttachmentTransformers,
  getValidCommands,
  getValidJobs,
  getValidPromptFragments,
  getValidTools,
} from '../../src/plugins/contribution-filter.js'
import type { PluginContributions, PluginManifest } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import { mockLogger } from '../utils/test-helpers.js'

function makeManifest(contributes: Partial<PluginManifest['contributes']> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
      ...contributes,
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
  }
}

describe('contribution-filter', () => {
  beforeEach(() => {
    mockLogger()
  })

  describe('getValidTools', () => {
    test('returns declared tools', () => {
      const manifest = makeManifest({ tools: ['my_tool'] })
      const contributions: PluginContributions = {
        tools: [{ name: 'my_tool', description: 'A tool', execute: () => Promise.resolve('ok') }],
        promptFragments: [],
      }
      const result = getValidTools('test-plugin', contributions, manifest)
      expect(result).toHaveLength(1)
    })

    test('drops undeclared tools', () => {
      const manifest = makeManifest({ tools: [] })
      const contributions: PluginContributions = {
        tools: [{ name: 'undeclared', description: 'Not declared', execute: () => Promise.resolve('ok') }],
        promptFragments: [],
      }
      const result = getValidTools('test-plugin', contributions, manifest)
      expect(result).toHaveLength(0)
    })
  })

  describe('getValidPromptFragments', () => {
    test('returns declared fragments', () => {
      const manifest = makeManifest({ promptFragments: ['hint'] })
      const contributions: PluginContributions = {
        tools: [],
        promptFragments: [{ name: 'hint', content: 'Use this hint' }],
      }
      const result = getValidPromptFragments('test-plugin', contributions, manifest)
      expect(result).toHaveLength(1)
    })

    test('drops undeclared fragments', () => {
      const manifest = makeManifest({ promptFragments: [] })
      const contributions: PluginContributions = {
        tools: [],
        promptFragments: [{ name: 'undeclared', content: 'nope' }],
      }
      const result = getValidPromptFragments('test-plugin', contributions, manifest)
      expect(result).toHaveLength(0)
    })
  })

  describe('getValidCommands', () => {
    test('returns declared commands', () => {
      const manifest = makeManifest({ commands: ['sync'] })
      const contributions: PluginContributions = {
        tools: [],
        promptFragments: [],
        commands: [{ name: 'sync', description: 'Sync', execute: () => {} }],
      }
      const result = getValidCommands('test-plugin', contributions, manifest)
      expect(result).toHaveLength(1)
    })

    test('drops undeclared commands', () => {
      const manifest = makeManifest({ commands: [] })
      const contributions: PluginContributions = {
        tools: [],
        promptFragments: [],
        commands: [{ name: 'undeclared', description: 'nope', execute: () => {} }],
      }
      const result = getValidCommands('test-plugin', contributions, manifest)
      expect(result).toHaveLength(0)
    })
  })

  describe('getValidJobs', () => {
    test('returns declared jobs', () => {
      const manifest = makeManifest({ jobs: ['daily'] })
      const contributions: PluginContributions = {
        tools: [],
        promptFragments: [],
        jobs: [{ name: 'daily', intervalMs: 60_000, execute: () => {} }],
      }
      const result = getValidJobs('test-plugin', contributions, manifest)
      expect(result).toHaveLength(1)
    })

    test('drops undeclared jobs', () => {
      const manifest = makeManifest({ jobs: [] })
      const contributions: PluginContributions = {
        tools: [],
        promptFragments: [],
        jobs: [{ name: 'undeclared', intervalMs: 60_000, execute: () => {} }],
      }
      const result = getValidJobs('test-plugin', contributions, manifest)
      expect(result).toHaveLength(0)
    })
  })

  describe('getValidAttachmentTransformers', () => {
    test('returns declared transformers', () => {
      const manifest = makeManifest({ attachmentTransformers: ['audio-transcriber'] })
      const contributions: PluginContributions = {
        tools: [],
        promptFragments: [],
        attachmentTransformers: [
          {
            name: 'audio-transcriber',
            mimePrefixes: ['audio/'],
            transform: () => Promise.resolve({ ok: true, text: 'hi' }),
          },
        ],
      }
      const result = getValidAttachmentTransformers('test-plugin', contributions, manifest)
      expect(result).toHaveLength(1)
    })

    test('drops undeclared transformers', () => {
      const manifest = makeManifest({ attachmentTransformers: [] })
      const contributions: PluginContributions = {
        tools: [],
        promptFragments: [],
        attachmentTransformers: [
          {
            name: 'undeclared',
            mimePrefixes: ['audio/'],
            transform: () => Promise.resolve({ ok: true, text: 'hi' }),
          },
        ],
      }
      const result = getValidAttachmentTransformers('test-plugin', contributions, manifest)
      expect(result).toHaveLength(0)
    })

    test('returns empty array when no transformers contributed', () => {
      const manifest = makeManifest({ attachmentTransformers: ['audio-transcriber'] })
      const contributions: PluginContributions = {
        tools: [],
        promptFragments: [],
      }
      const result = getValidAttachmentTransformers('test-plugin', contributions, manifest)
      expect(result).toHaveLength(0)
    })
  })
})
