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
import { getContributedTaskProviderType } from '../../src/providers/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

declare global {
  var papaiDeactivateOrder: string[] | undefined
}

const tempDirs: string[] = []

function makeManifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
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

function makePlugin(id: string, entryPoint: string, manifestOverrides: Partial<PluginManifest> = {}): DiscoveredPlugin {
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

    expect(pluginRegistry.getEntry('bad-plugin')?.state).toBe('error')
    expect(getRecentRuntimeEvents('bad-plugin', 1)[0]?.message).toContain('Import failed')
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

    expect(pluginRegistry.getEntry('factory-plugin')?.state).toBe('active')
    expect(contributionRegistry.getContributions('factory-plugin')?.tools).toHaveLength(1)
    expect(getRecentRuntimeEvents('factory-plugin', 1)[0]?.eventType).toBe('activated')
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

    expect(pluginRegistry.getEntry('object-plugin')?.state).toBe('error')
    expect(getRecentRuntimeEvents('object-plugin', 1)[0]?.message).toContain('Invalid plugin module contract')
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

    expect(pluginRegistry.getEntry('timeout-plugin')?.state).toBe('error')
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

    expect(pluginRegistry.getEntry('throwing-plugin')?.state).toBe('error')
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
    expect(getRecentRuntimeEvents('deactivate-error-plugin', 1)[0]?.message).toContain('deactivate boom')
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
    expect(getContributedTaskProviderType('demo')?.pluginId).toBe('provider-plugin')

    await deactivateAllPlugins()
    expect(getContributedTaskProviderType('demo')).toBeUndefined()
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

    expect(getTaskInstance('demo-stop-instance')?.status).toBe('active')
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

    expect(getTaskInstance('demo-retire-instance')?.status).toBe('stopped')
  })
})
