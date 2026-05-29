// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { getTaskInstance, insertTaskInstance } from '../../src/instances/task-store.js'
import { contributionRegistry } from '../../src/plugins/contributions.js'
import {
  activatePlugins,
  deactivateAllPlugins,
  getActivatedPluginIds,
  toPluginImportSpecifier,
} from '../../src/plugins/loader.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import { getRecentRuntimeEvents } from '../../src/plugins/store.js'
import type { DiscoveredPlugin, PluginManifest } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import {
  createProvider,
  getTaskProviderConfigValidator,
  getTaskProviderDescriptor,
} from '../../src/providers/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

declare global {
  var papaiDeactivateOrder: string[] | undefined
  var papaiLateRegistrationError: string | undefined
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

  test('converts entry point paths to portable file URLs before import', () => {
    const entryPoint = '/tmp/plugin entry.mjs'

    expect(toPluginImportSpecifier(entryPoint)).toBe(pathToFileURL(entryPoint).href)
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

  test('late registration after successful activation is rejected', async () => {
    const entryPoint = writeTempPluginModule(`
      globalThis.papaiLateRegistrationError = undefined
      export default function createPlugin() {
        return {
          activate(ctx) {
            setTimeout(() => {
              try {
                ctx.registration.registerTool({
                  name: 'registered_tool',
                  description: 'Registered tool',
                  execute: async () => 'late',
                })
              } catch (error) {
                globalThis.papaiLateRegistrationError = error instanceof Error ? error.message : String(error)
              }
            }, 50)
            ctx.registration.registerTool({
              name: 'registered_tool',
              description: 'Registered tool',
              execute: async () => 'ok',
            })
          },
        }
      }
    `)
    const plugin = makePlugin('late-success-plugin', entryPoint, {
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
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100)
    })

    expect(globalThis.papaiLateRegistrationError).toBe('Plugin registration is only allowed during activation')
    expect(
      requireValue(contributionRegistry.getContributions('late-success-plugin'), 'late success plugin contributions')
        .tools,
    ).toHaveLength(1)
  })

  test('microtask registration queued at activation tail is rejected before publish', async () => {
    const entryPoint = writeTempPluginModule(`
      globalThis.papaiLateRegistrationError = undefined
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTool({
              name: 'registered_tool',
              description: 'Registered tool',
              execute: async () => 'ok',
            })
            queueMicrotask(() => {
              try {
                ctx.registration.registerTool({
                  name: 'registered_tool',
                  description: 'Registered tool',
                  execute: async () => 'microtask',
                })
              } catch (error) {
                globalThis.papaiLateRegistrationError = error instanceof Error ? error.message : String(error)
              }
            })
          },
        }
      }
    `)
    const plugin = makePlugin('microtask-success-plugin', entryPoint, {
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

    expect(globalThis.papaiLateRegistrationError).toBe('Plugin registration is only allowed during activation')
    expect(
      requireValue(
        contributionRegistry.getContributions('microtask-success-plugin'),
        'microtask success plugin contributions',
      ).tools,
    ).toHaveLength(1)
  })

  test('marks explicit mcp-only plugins active without importing an entry point', async () => {
    const plugin = makePlugin('mcp-only-plugin', '', {
      main: '',
      mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    expect(requireValue(pluginRegistry.getEntry('mcp-only-plugin'), 'mcp-only plugin registry entry').state).toBe(
      'active',
    )
    expect(
      requireValue(getRecentRuntimeEvents('mcp-only-plugin', 1)[0], 'mcp-only plugin runtime event').eventType,
    ).toBe('activated')
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

  test('timeout plugin does not publish late provider registration after activation failure', async () => {
    const entryPoint = writeTempPluginModule(`
      globalThis.papaiLateRegistrationError = undefined
      export default function createPlugin() {
        return {
          activate(ctx) {
            setTimeout(() => {
              try {
                ctx.registration.registerTaskProviderType('late-timeout-provider', () => ({}))
              } catch (error) {
                globalThis.papaiLateRegistrationError = error instanceof Error ? error.message : String(error)
              }
            }, 150)
            return new Promise(() => {})
          },
        }
      }
    `)
    const plugin = makePlugin('late-timeout-plugin', entryPoint, {
      activationTimeoutMs: 100,
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['late-timeout-provider'],
      },
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200)
    })

    expect(
      requireValue(pluginRegistry.getEntry('late-timeout-plugin'), 'late timeout plugin registry entry').state,
    ).toBe('error')
    expect(globalThis.papaiLateRegistrationError).toBe('Plugin registration is only allowed during activation')
    expect(getTaskProviderDescriptor('late-timeout-provider')).toBeUndefined()
  })

  test('late registration after activation timeout is rejected', async () => {
    const entryPoint = writeTempPluginModule(`
      globalThis.papaiLateRegistrationError = undefined
      export default function createPlugin() {
        return {
          activate(ctx) {
            setTimeout(() => {
              try {
                ctx.registration.registerTaskProviderType('late-timeout-provider', () => ({}))
              } catch (error) {
                globalThis.papaiLateRegistrationError = error instanceof Error ? error.message : String(error)
              }
            }, 150)
            return new Promise(() => {})
          },
        }
      }
    `)
    const plugin = makePlugin('late-timeout-rejection-plugin', entryPoint, {
      activationTimeoutMs: 100,
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['late-timeout-provider'],
      },
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200)
    })

    expect(globalThis.papaiLateRegistrationError).toBe('Plugin registration is only allowed during activation')
    expect(getTaskProviderDescriptor('late-timeout-provider')).toBeUndefined()
  })

  test('duplicate contributed provider type fails later plugin activation', async () => {
    const firstEntry = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('duplicate-provider', () => ({}))
          },
        }
      }
    `)
    const secondEntry = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('duplicate-provider', () => ({}))
          },
        }
      }
    `)
    const firstPlugin = makePlugin('first-duplicate-provider-plugin', firstEntry, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['duplicate-provider'],
      },
    })
    const secondPlugin = makePlugin('second-duplicate-provider-plugin', secondEntry, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['duplicate-provider'],
      },
    })
    approvePlugin(firstPlugin)
    approvePlugin(secondPlugin)

    await activatePlugins([firstPlugin, secondPlugin])

    expect(
      requireValue(pluginRegistry.getEntry('first-duplicate-provider-plugin'), 'first duplicate plugin registry entry')
        .state,
    ).toBe('active')
    expect(
      requireValue(
        pluginRegistry.getEntry('second-duplicate-provider-plugin'),
        'second duplicate plugin registry entry',
      ).state,
    ).toBe('error')
  })

  test('resolves manifest-owned provider config validator named export during activation', async () => {
    const entryPoint = writeTempPluginModule(`
      export async function validateDemoConfig(config) {
        return config.baseUrl === 'https://ok.invalid'
          ? { ok: true }
          : { ok: false, reason: 'baseUrl rejected' }
      }

      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('validated-provider', () => ({}))
          },
        }
      }
    `)
    const plugin = makePlugin('validated-provider-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['validated-provider'],
      },
      providerConfigValidator: 'validateDemoConfig',
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    const validator = requireValue(
      getTaskProviderConfigValidator('validated-provider'),
      'validated-provider config validator',
    )
    await expect(validator({ baseUrl: 'https://bad.invalid' })).resolves.toEqual({
      ok: false,
      reason: 'baseUrl rejected',
    })
  })

  test('fails activation when manifest-owned provider config validator export is missing', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('missing-validator-provider', () => ({}))
          },
        }
      }
    `)
    const plugin = makePlugin('missing-validator-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['missing-validator-provider'],
      },
      providerConfigValidator: 'validateMissingConfig',
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    expect(
      requireValue(pluginRegistry.getEntry('missing-validator-plugin'), 'missing validator registry entry').state,
    ).toBe('error')
    expect(getTaskProviderDescriptor('missing-validator-provider')).toBeUndefined()
    expect(
      requireValue(getRecentRuntimeEvents('missing-validator-plugin', 1)[0], 'missing validator runtime event').message,
    ).toContain('providerConfigValidator')
  })

  test('fails activation when manifest-owned provider config validator export is not a function', async () => {
    const entryPoint = writeTempPluginModule(`
      export const validateBadConfig = 'not-a-function'

      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('bad-validator-provider', () => ({}))
          },
        }
      }
    `)
    const plugin = makePlugin('bad-validator-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['bad-validator-provider'],
      },
      providerConfigValidator: 'validateBadConfig',
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    expect(requireValue(pluginRegistry.getEntry('bad-validator-plugin'), 'bad validator registry entry').state).toBe(
      'error',
    )
    expect(getTaskProviderDescriptor('bad-validator-provider')).toBeUndefined()
    expect(
      requireValue(getRecentRuntimeEvents('bad-validator-plugin', 1)[0], 'bad validator runtime event').message,
    ).toContain('providerConfigValidator')
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
      requireValue(pluginRegistry.getEntry('deactivate-error-plugin'), 'deactivate error registry entry').state,
    ).toBe('approved')
    expect(
      requireValue(getRecentRuntimeEvents('deactivate-error-plugin', 1)[0], 'deactivate error runtime event').message,
    ).toContain('deactivate boom')
  })

  test('deactivate context rejects registration attempts', async () => {
    const entryPoint = writeTempPluginModule(`
      globalThis.papaiLateRegistrationError = undefined
      export default function createPlugin() {
        return {
          activate() {},
          deactivate(ctx) {
            try {
              ctx.registration.registerTool({
                name: 'registered_tool',
                description: 'Registered tool',
                execute: async () => 'late',
              })
            } catch (error) {
              globalThis.papaiLateRegistrationError = error instanceof Error ? error.message : String(error)
            }
          },
        }
      }
    `)
    const plugin = makePlugin('deactivate-registration-plugin', entryPoint, {
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

    expect(globalThis.papaiLateRegistrationError).toBe('Plugin registration is only allowed during activation')
    expect(contributionRegistry.getContributions('deactivate-registration-plugin')).toBeUndefined()
  })

  test('removes contributed provider type on deactivation', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('demo', () => ({}))
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
            ctx.registration.registerTaskProviderType('demo-stop', () => ({}))
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
            ctx.registration.registerTaskProviderType('demo-retire', () => ({}))
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
