// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { getTaskInstance, insertTaskInstance } from '../../src/instances/task-store.js'
import { contributionRegistry } from '../../src/plugins/contributions.js'
import { activatePlugins, deactivateAllPlugins, getActivatedPluginIds } from '../../src/plugins/loader.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import { getRecentRuntimeEvents } from '../../src/plugins/store.js'
import type { DiscoveredPlugin, PluginManifest } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import { createProvider, getTaskProviderDescriptor } from '../../src/providers/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

declare global {
  var papaiDeactivateOrder: string[] | undefined
}

const tempDirs: string[] = []

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`${label} was unexpectedly absent`)
  return value
}

function makeManifest(
  ...args: readonly [id: string] | readonly [id: string, overrides: Partial<PluginManifest>]
): PluginManifest {
  const [id] = args
  const overrides = args.length === 2 ? args[1] : {}
  return {
    id,
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
    },
    permissions: [],
    defaultEnabled: false,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerConfigSchema: [],
    providerAllowedHosts: [],
    ...overrides,
  }
}

function makePlugin(
  ...args:
    | readonly [id: string, entryPoint: string]
    | readonly [id: string, entryPoint: string, manifestOverrides: Partial<PluginManifest>]
): DiscoveredPlugin {
  const [id, entryPoint] = args
  const manifestOverrides = args.length === 3 ? args[2] : {}
  return {
    manifest: makeManifest(id, manifestOverrides),
    pluginDir: dirname(entryPoint),
    entryPoint,
    manifestHash: `hash-${id}`,
  }
}

function writeTempPluginModule(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'papai-plugin-loader-'))
  tempDirs.push(dir)
  const modulePath = join(dir, 'index.mjs')
  writeFileSync(modulePath, source)
  return modulePath
}

function approvePlugin(plugin: DiscoveredPlugin): void {
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
}

describe('activatePlugins', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    await deactivateAllPlugins()
    globalThis.papaiDeactivateOrder = []
  })

  afterEach(async () => {
    await deactivateAllPlugins()
    tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
    globalThis.papaiDeactivateOrder = undefined
  })

  test('does nothing when passed empty list', async () => {
    await activatePlugins([])
    expect(getActivatedPluginIds()).toEqual([])
  })

  test('marks plugin as error when entry point cannot be imported', async () => {
    const plugin = makePlugin('bad-plugin', '/nonexistent/path.ts')
    approvePlugin(plugin)

    await activatePlugins([plugin])

    expect(requireValue(pluginRegistry.getEntry('bad-plugin'), 'bad plugin registry entry').state).toBe('error')
    expect(requireValue(getRecentRuntimeEvents('bad-plugin', 1)[0], 'bad plugin runtime event').message).toContain(
      'Import failed',
    )
  })

  test('accepts default-exported factory returning plugin instance', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTool({
              name: 'registered_tool',
              description: 'Registered tool',
              execute: async () => 'ok',
            })
          },
        }
      }
    `)
    const plugin = makePlugin('factory-plugin', entryPoint, {
      contributes: {
        tools: ['registered_tool'],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
      },
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    expect(requireValue(pluginRegistry.getEntry('factory-plugin'), 'factory plugin registry entry').state).toBe(
      'active',
    )
    expect(
      requireValue(contributionRegistry.getContributions('factory-plugin'), 'factory plugin contributions').tools,
    ).toHaveLength(1)
    expect(requireValue(getRecentRuntimeEvents('factory-plugin', 1)[0], 'factory plugin runtime event').eventType).toBe(
      'activated',
    )
  })

  test('rejects default-exported object plugin contract', async () => {
    const entryPoint = writeTempPluginModule(`
      export default {
        activate() {
          return undefined
        },
      }
    `)
    const plugin = makePlugin('object-plugin', entryPoint)
    approvePlugin(plugin)

    await activatePlugins([plugin])

    expect(requireValue(pluginRegistry.getEntry('object-plugin'), 'object plugin registry entry').state).toBe('error')
    expect(
      requireValue(getRecentRuntimeEvents('object-plugin', 1)[0], 'object plugin runtime event').message,
    ).toContain('Invalid plugin module contract')
  })

  test('activation timeout cleans framework-owned partial contributions', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTool({ name: 'partial_tool', description: 'Partial', execute: async () => 'x' })
            return new Promise(() => {})
          },
        }
      }
    `)
    const plugin = makePlugin('timeout-plugin', entryPoint, {
      activationTimeoutMs: 100,
      contributes: {
        tools: ['partial_tool'],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
      },
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    expect(requireValue(pluginRegistry.getEntry('timeout-plugin'), 'timeout plugin registry entry').state).toBe('error')
    expect(contributionRegistry.getContributions('timeout-plugin')).toBeUndefined()
  })

  test('activation failure cleans framework-owned partial contributions', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTool({ name: 'partial_tool', description: 'Partial', execute: async () => 'x' })
            throw new Error('boom')
          },
        }
      }
    `)
    const plugin = makePlugin('throwing-plugin', entryPoint, {
      contributes: {
        tools: ['partial_tool'],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
      },
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    expect(requireValue(pluginRegistry.getEntry('throwing-plugin'), 'throwing plugin registry entry').state).toBe(
      'error',
    )
    expect(contributionRegistry.getContributions('throwing-plugin')).toBeUndefined()
  })

  test('deactivation runs plugins in deterministic reverse activation order', async () => {
    const firstEntryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate() {},
          deactivate() { globalThis.papaiDeactivateOrder.push('first-plugin') },
        }
      }
    `)
    const secondEntryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate() {},
          async deactivate() {
            await new Promise((resolve) => setTimeout(resolve, 50))
            globalThis.papaiDeactivateOrder.push('second-plugin')
          },
        }
      }
    `)
    const firstPlugin = makePlugin('first-plugin', firstEntryPoint)
    const secondPlugin = makePlugin('second-plugin', secondEntryPoint)
    approvePlugin(firstPlugin)
    approvePlugin(secondPlugin)

    await activatePlugins([firstPlugin, secondPlugin])
    await deactivateAllPlugins()

    expect(globalThis.papaiDeactivateOrder).toEqual(['second-plugin', 'first-plugin'])
  })

  test('deactivation error still cleans framework-owned contributions', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTool({ name: 'registered_tool', description: 'Registered', execute: async () => 'x' })
          },
          deactivate() { throw new Error('deactivate boom') },
        }
      }
    `)
    const plugin = makePlugin('deactivate-error-plugin', entryPoint, {
      contributes: {
        tools: ['registered_tool'],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
      },
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])
    await deactivateAllPlugins()

    expect(contributionRegistry.getContributions('deactivate-error-plugin')).toBeUndefined()
    expect(
      requireValue(getRecentRuntimeEvents('deactivate-error-plugin', 1)[0], 'deactivate error runtime event').message,
    ).toContain('deactivate boom')
  })

  test('removes contributed provider type on deactivation', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('demo', { factory: () => ({}) })
          },
        }
      }
    `)
    const plugin = makePlugin('provider-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['demo'],
      },
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])
    expect(requireValue(getTaskProviderDescriptor('demo'), 'demo task provider descriptor').source).toEqual({
      plugin: 'provider-plugin',
    })
    expect(() => createProvider('demo', {})).not.toThrow()

    await deactivateAllPlugins()
    expect(getTaskProviderDescriptor('demo')).toBeUndefined()
    expect(() => createProvider('demo', {})).toThrow('Unknown provider: demo')
  })

  test('keeps active task instances when plugin runtime shuts down normally', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('demo-stop', { factory: () => ({}) })
          },
        }
      }
    `)
    const plugin = makePlugin('provider-stop-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['demo-stop'],
      },
    })
    approvePlugin(plugin)
    insertTaskInstance({ id: 'demo-stop-instance', type: 'demo-stop', config: {}, status: 'active' })

    await activatePlugins([plugin])
    await deactivateAllPlugins()

    expect(requireValue(getTaskInstance('demo-stop-instance'), 'demo stop task instance').status).toBe('active')
  })

  test('stops active task instances when contributed provider type is retired', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('demo-retire', { factory: () => ({}) })
          },
        }
      }
    `)
    const plugin = makePlugin('provider-retire-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['demo-retire'],
      },
    })
    approvePlugin(plugin)
    insertTaskInstance({ id: 'demo-retire-instance', type: 'demo-retire', config: {}, status: 'active' })

    await activatePlugins([plugin])
    await deactivateAllPlugins({ retireContributedProviders: true })

    expect(requireValue(getTaskInstance('demo-retire-instance'), 'demo retire task instance').status).toBe('stopped')
  })
})
