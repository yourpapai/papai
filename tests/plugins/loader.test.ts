// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { eq, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { pluginRuntimeEvents } from '../../src/db/schema.js'
import { getTaskInstance, insertTaskInstance } from '../../src/instances/task-store.js'
import { contributionRegistry } from '../../src/plugins/contributions.js'
import {
  activatePlugins,
  deactivateAllPlugins,
  getActivatedPluginIds,
  toPluginImportSpecifier,
} from '../../src/plugins/loader.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import type { DiscoveredPlugin, PluginManifest } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import {
  createProvider,
  getTaskProviderConfigValidator,
  getTaskProviderDescriptor,
} from '../../src/providers/registry.js'
import { mockLogger, setupTestDb, waitFor } from '../utils/test-helpers.js'

declare global {
  var papaiDeactivateOrder: string[] | undefined
  var papaiLateRegistrationError: string | undefined
  var papaiPluginFactoryCount: number | undefined
}

const tempDirs: string[] = []

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`${label} was unexpectedly absent`)
  return value
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function getRecentRuntimeEvents(
  pluginId: string,
  limit = 20,
): Array<{ eventType: string; message: string | null; occurredAt: string }> {
  return getDrizzleDb()
    .select({
      eventType: pluginRuntimeEvents.eventType,
      message: pluginRuntimeEvents.message,
      occurredAt: pluginRuntimeEvents.occurredAt,
    })
    .from(pluginRuntimeEvents)
    .where(eq(pluginRuntimeEvents.pluginId, pluginId))
    .orderBy(sql`${pluginRuntimeEvents.occurredAt} DESC, rowid DESC`)
    .limit(limit)
    .all()
}

function makeManifest(
  ...args: readonly [id: string] | readonly [id: string, overrides: Partial<PluginManifest>]
): PluginManifest {
  const [id] = args
  const overrides = args.length === 2 ? args[1] : {}
  const baseManifest: PluginManifest = {
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
  }
  return {
    ...baseManifest,
    ...overrides,
    contributes: overrides.contributes ?? baseManifest.contributes,
    providerTraits: overrides.providerTraits ?? baseManifest.providerTraits,
    providerContextConfigSchema: overrides.providerContextConfigSchema ?? baseManifest.providerContextConfigSchema,
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
    globalThis.papaiPluginFactoryCount = 0
  })

  afterEach(async () => {
    await deactivateAllPlugins()
    tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
    globalThis.papaiDeactivateOrder = undefined
    globalThis.papaiPluginFactoryCount = undefined
  })

  test('does nothing when passed empty list', async () => {
    await activatePlugins([])
    expect(getActivatedPluginIds()).toEqual([])
  })

  test('passes owned provider runtime dependencies into plugin activation', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          async activate(ctx) {
            const response = await ctx.providerRuntime.httpFetch('https://api.example.com/value')
            ctx.registration.registerPromptFragment({ name: 'result', content: await response.text() })
          },
        }
      }
    `)
    const plugin = makePlugin('injected-http-plugin', entryPoint, {
      permissions: ['http'],
      providerAllowedHosts: ['api.example.com'],
      contributes: {
        tools: [],
        promptFragments: ['result'],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
        attachmentTransformers: [],
      },
    })
    approvePlugin(plugin)
    const fetch = mock(() => Promise.resolve(new Response('owned response')))

    await activatePlugins([plugin], { providerRuntimeDeps: { fetch, assertPublicUrl: () => Promise.resolve() } })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(contributionRegistry.getContributions(plugin.manifest.id)?.promptFragments).toEqual([
      { name: 'result', content: 'owned response' },
    ])
  })

  test('uses each plugin activation HTTP dependency again during deactivation without crossing instances', async () => {
    const lifecyclePlugin = (id: string): DiscoveredPlugin => {
      const entryPoint = writeTempPluginModule(`
        export default function createPlugin() {
          return {
            async activate(ctx) {
              await ctx.providerRuntime.httpFetch('https://api.example.com/${id}/activate')
            },
            async deactivate(ctx) {
              await ctx.providerRuntime.httpFetch('https://api.example.com/${id}/deactivate')
            },
          }
        }
      `)
      return makePlugin(id, entryPoint, { permissions: ['http'], providerAllowedHosts: ['api.example.com'] })
    }
    const first = lifecyclePlugin('owned-first')
    const second = lifecyclePlugin('owned-second')
    approvePlugin(first)
    approvePlugin(second)
    const firstUrls: string[] = []
    const secondUrls: string[] = []
    const replacementUrls: string[] = []
    const firstFetch = mock((url: string) => {
      firstUrls.push(url)
      return Promise.resolve(new Response('first'))
    })
    const secondFetch = mock((url: string) => {
      secondUrls.push(url)
      return Promise.resolve(new Response('second'))
    })
    const replacementFetch = mock((url: string) => {
      replacementUrls.push(url)
      return Promise.resolve(new Response('replacement'))
    })
    const publicUrl = (): Promise<void> => Promise.resolve()

    await activatePlugins([first], { providerRuntimeDeps: { fetch: firstFetch, assertPublicUrl: publicUrl } })
    await activatePlugins([second], { providerRuntimeDeps: { fetch: secondFetch, assertPublicUrl: publicUrl } })
    await deactivateAllPlugins()
    await activatePlugins([first], {
      providerRuntimeDeps: { fetch: replacementFetch, assertPublicUrl: publicUrl },
    })
    await deactivateAllPlugins()

    expect(firstUrls).toEqual([
      'https://api.example.com/owned-first/activate',
      'https://api.example.com/owned-first/deactivate',
    ])
    expect(secondUrls).toEqual([
      'https://api.example.com/owned-second/activate',
      'https://api.example.com/owned-second/deactivate',
    ])
    expect(replacementUrls).toEqual([
      'https://api.example.com/owned-first/activate',
      'https://api.example.com/owned-first/deactivate',
    ])
  })

  test('builds the default provider runtime for both lifecycle phases when no dependencies are supplied', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            globalThis.papaiDeactivateOrder.push(ctx.providerRuntime.allowedHosts.has('api.example.com') ? 'activate' : 'missing')
          },
          deactivate(ctx) {
            globalThis.papaiDeactivateOrder.push(ctx.providerRuntime.allowedHosts.has('api.example.com') ? 'deactivate' : 'missing')
          },
        }
      }
    `)
    const plugin = makePlugin('default-http-plugin', entryPoint, {
      permissions: ['http'],
      providerAllowedHosts: ['api.example.com'],
    })
    approvePlugin(plugin)
    await activatePlugins([plugin])
    await deactivateAllPlugins()

    expect(globalThis.papaiDeactivateOrder).toEqual(['activate', 'deactivate'])
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

  test('active plugin reapproval is idempotent and retains its original instance and dependencies', async () => {
    globalThis.papaiLateRegistrationError = undefined
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/activate') },
          deactivate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/deactivate') },
        }
      }
    `)
    const plugin = makePlugin('failed-reactivation-plugin', entryPoint, {
      permissions: ['http'],
      providerAllowedHosts: ['api.example.com'],
    })
    approvePlugin(plugin)
    const urls: string[] = []
    await activatePlugins([plugin], {
      providerRuntimeDeps: {
        fetch: (url) => {
          urls.push(url)
          return Promise.resolve(new Response('owned'))
        },
        assertPublicUrl: () => Promise.resolve(),
      },
    })
    const replacementEntry = writeTempPluginModule(`
      globalThis.papaiLateRegistrationError = 'replacement module imported'
      export default function createPlugin() {
        throw new Error('replacement factory must not run')
      }
    `)
    const replacement = makePlugin(plugin.manifest.id, replacementEntry, {
      permissions: ['http'],
      providerAllowedHosts: ['api.example.com'],
    })
    approvePlugin(replacement)

    await activatePlugins([replacement])
    await deactivateAllPlugins()

    expect(getActivatedPluginIds()).toEqual([])
    expect(contributionRegistry.getContributions(plugin.manifest.id)).toBeUndefined()
    expect(globalThis.papaiLateRegistrationError).toBeUndefined()
    expect(urls).toEqual(['https://api.example.com/activate', 'https://api.example.com/deactivate'])
  })

  test('serializes concurrent activation calls for the same plugin and retains the first dependencies', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        globalThis.papaiPluginFactoryCount = (globalThis.papaiPluginFactoryCount ?? 0) + 1
        return {
          activate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/activate') },
          deactivate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/deactivate') },
        }
      }
    `)
    const plugin = makePlugin('concurrent-same-plugin', entryPoint, {
      permissions: ['http'],
      providerAllowedHosts: ['api.example.com'],
    })
    approvePlugin(plugin)
    const activationStarted = deferred<true>()
    const activationResponse = deferred<Response>()
    const firstUrls: string[] = []
    const secondUrls: string[] = []
    const firstResponses = [activationResponse.promise, Promise.resolve(new Response('deactivated'))]
    const publicUrl = (): Promise<void> => Promise.resolve()
    const firstFetch = (url: string): Promise<Response> => {
      firstUrls.push(url)
      activationStarted.resolve(true)
      return requireValue(firstResponses.shift(), 'first lifecycle response')
    }
    const secondFetch = (url: string): Promise<Response> => {
      secondUrls.push(url)
      return activationResponse.promise
    }

    const first = activatePlugins([plugin], {
      providerRuntimeDeps: { fetch: firstFetch, assertPublicUrl: publicUrl },
    })
    const second = activatePlugins([plugin], {
      providerRuntimeDeps: { fetch: secondFetch, assertPublicUrl: publicUrl },
    })
    await activationStarted.promise
    activationResponse.resolve(new Response('activated'))
    await Promise.all([first, second])

    expect(globalThis.papaiPluginFactoryCount).toBe(1)
    expect(getActivatedPluginIds()).toEqual([plugin.manifest.id])
    await deactivateAllPlugins()

    expect(firstUrls).toEqual(['https://api.example.com/activate', 'https://api.example.com/deactivate'])
    expect(secondUrls).toEqual([])
    expect(getActivatedPluginIds()).toEqual([])
  })

  test('waits for in-flight activation before deactivating and leaves no published lifecycle state', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerPromptFragment({ name: 'gate', content: 'active' })
            return ctx.providerRuntime.httpFetch('https://api.example.com/activate')
          },
          deactivate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/deactivate') },
        }
      }
    `)
    const plugin = makePlugin('activation-teardown-race', entryPoint, {
      permissions: ['http'],
      providerAllowedHosts: ['api.example.com'],
      contributes: {
        tools: [],
        promptFragments: ['gate'],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
        attachmentTransformers: [],
      },
    })
    approvePlugin(plugin)
    const activationStarted = deferred<true>()
    const activationResponse = deferred<Response>()
    const urls: string[] = []
    const responses = [activationResponse.promise, Promise.resolve(new Response('deactivated'))]
    const activation = activatePlugins([plugin], {
      providerRuntimeDeps: {
        fetch: (url: string): Promise<Response> => {
          urls.push(url)
          activationStarted.resolve(true)
          return requireValue(responses.shift(), 'activation teardown response')
        },
        assertPublicUrl: (): Promise<void> => Promise.resolve(),
      },
    })

    await activationStarted.promise
    const teardown = deactivateAllPlugins()
    activationResponse.resolve(new Response('activated'))
    await Promise.all([activation, teardown])

    expect(urls).toEqual(['https://api.example.com/activate', 'https://api.example.com/deactivate'])
    expect(getActivatedPluginIds()).toEqual([])
    expect(contributionRegistry.getContributions(plugin.manifest.id)).toBeUndefined()
  })

  test('serializes a concurrent retry after failed activation without retaining stale lifecycle state', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/activate') },
          deactivate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/deactivate') },
        }
      }
    `)
    const plugin = makePlugin('concurrent-retry-plugin', entryPoint, {
      permissions: ['http'],
      providerAllowedHosts: ['api.example.com'],
    })
    approvePlugin(plugin)
    const firstStarted = deferred<true>()
    const firstResponse = deferred<Response>()
    const retryUrls: string[] = []
    const publicUrl = (): Promise<void> => Promise.resolve()
    const first = activatePlugins([plugin], {
      providerRuntimeDeps: {
        fetch: (): Promise<Response> => {
          firstStarted.resolve(true)
          return firstResponse.promise
        },
        assertPublicUrl: publicUrl,
      },
    })
    await firstStarted.promise
    const retry = activatePlugins([plugin], {
      providerRuntimeDeps: {
        fetch: (url: string): Promise<Response> => {
          retryUrls.push(url)
          return Promise.resolve(new Response('retry'))
        },
        assertPublicUrl: publicUrl,
      },
    })
    firstResponse.reject(new Error('first activation failed'))

    await Promise.all([first, retry])
    expect(getActivatedPluginIds()).toEqual([plugin.manifest.id])
    await deactivateAllPlugins()

    expect(retryUrls).toEqual(['https://api.example.com/activate', 'https://api.example.com/deactivate'])
    expect(getActivatedPluginIds()).toEqual([])
  })

  test('first activation failure leaves no lifecycle record and a later retry activates normally', async () => {
    const failingEntry = writeTempPluginModule(`
      export default function createPlugin() {
        return { activate() { throw new Error('first activation failed') } }
      }
    `)
    const retryEntry = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate() { globalThis.papaiDeactivateOrder.push('retry-activate') },
          deactivate() { globalThis.papaiDeactivateOrder.push('retry-deactivate') },
        }
      }
    `)
    const failing = makePlugin('retry-plugin', failingEntry)
    approvePlugin(failing)
    await activatePlugins([failing])
    expect(getActivatedPluginIds()).toEqual([])

    const retry = makePlugin('retry-plugin', retryEntry)
    approvePlugin(retry)
    await activatePlugins([retry])
    await deactivateAllPlugins()

    expect(globalThis.papaiDeactivateOrder).toEqual(['retry-activate', 'retry-deactivate'])
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
        attachmentTransformers: [],
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
            }, 10)
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
        attachmentTransformers: [],
      },
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])
    await waitFor(() => globalThis.papaiLateRegistrationError !== undefined)

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
        attachmentTransformers: [],
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
        attachmentTransformers: [],
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
        attachmentTransformers: [],
      },
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])
    await waitFor(() => globalThis.papaiLateRegistrationError !== undefined)

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
        attachmentTransformers: [],
      },
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])
    await waitFor(() => globalThis.papaiLateRegistrationError !== undefined)

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
        attachmentTransformers: [],
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
        attachmentTransformers: [],
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
        attachmentTransformers: [],
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
        attachmentTransformers: [],
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
        attachmentTransformers: [],
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

  test('fails activation when providerConfigValidator points at default export', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('default-validator-provider', () => ({}))
          },
        }
      }
    `)
    const plugin = makePlugin('default-validator-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['default-validator-provider'],
        attachmentTransformers: [],
      },
      providerConfigValidator: 'default',
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    expect(
      requireValue(pluginRegistry.getEntry('default-validator-plugin'), 'default validator registry entry').state,
    ).toBe('error')
    expect(getTaskProviderDescriptor('default-validator-provider')).toBeUndefined()
    expect(
      requireValue(getRecentRuntimeEvents('default-validator-plugin', 1)[0], 'default validator runtime event').message,
    ).toContain('providerConfigValidator')
  })

  test('fails activation when providerConfigValidator is declared but no task provider type is registered', async () => {
    const entryPoint = writeTempPluginModule(`
      export async function validateForgottenProviderConfig() {
        return { ok: true }
      }

      export default function createPlugin() {
        return {
          activate() {},
        }
      }
    `)
    const plugin = makePlugin('validator-without-provider-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['forgotten-provider'],
        attachmentTransformers: [],
      },
      providerConfigValidator: 'validateForgottenProviderConfig',
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    expect(
      requireValue(
        pluginRegistry.getEntry('validator-without-provider-plugin'),
        'validator without provider registry entry',
      ).state,
    ).toBe('error')
    expect(getTaskProviderDescriptor('forgotten-provider')).toBeUndefined()
    expect(
      requireValue(
        getRecentRuntimeEvents('validator-without-provider-plugin', 1)[0],
        'validator without provider runtime event',
      ).message,
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
        attachmentTransformers: [],
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
            await new Promise((resolve) => setTimeout(resolve, 10))
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

  test('records each activated plugin only once', async () => {
    const firstEntry = writeTempPluginModule(`
      export default function createPlugin() {
        return { activate() {} }
      }
    `)
    const secondEntry = writeTempPluginModule(`
      export default function createPlugin() {
        return { activate() {} }
      }
    `)
    const first = makePlugin('once-a', firstEntry)
    const second = makePlugin('once-b', secondEntry)
    approvePlugin(first)
    approvePlugin(second)

    await activatePlugins([first, second])

    expect(getActivatedPluginIds()).toEqual(['once-a', 'once-b'])
  })

  test('deactivates each plugin only once even after multiple activations', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate() {
            globalThis.papaiDeactivateOrder = [...(globalThis.papaiDeactivateOrder ?? []), 'activate']
          },
          deactivate() {
            globalThis.papaiDeactivateOrder = [...(globalThis.papaiDeactivateOrder ?? []), 'deactivate']
          },
        }
      }
    `)
    const plugin = makePlugin('single-pass', entryPoint)
    approvePlugin(plugin)

    await activatePlugins([plugin])
    await activatePlugins([plugin])
    await deactivateAllPlugins()

    expect(globalThis.papaiDeactivateOrder).toEqual(['activate', 'deactivate'])
  })

  test('tears down loader-owned plugins after registry state changes without clobbering admin state', async () => {
    const lifecyclePlugin = (id: string): DiscoveredPlugin => {
      const entryPoint = writeTempPluginModule(`
        export default function createPlugin() {
          return {
            activate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/${id}/activate') },
            deactivate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/${id}/deactivate') },
          }
        }
      `)
      return makePlugin(id, entryPoint, {
        permissions: ['http'],
        providerAllowedHosts: ['api.example.com'],
      })
    }
    const approved = lifecyclePlugin('tracked-approved-plugin')
    const rejected = lifecyclePlugin('tracked-rejected-plugin')
    approvePlugin(approved)
    approvePlugin(rejected)
    const urls: string[] = []
    await activatePlugins([approved, rejected], {
      providerRuntimeDeps: {
        fetch: (url: string): Promise<Response> => {
          urls.push(url)
          return Promise.resolve(new Response('ok'))
        },
        assertPublicUrl: (): Promise<void> => Promise.resolve(),
      },
    })

    pluginRegistry.approve(approved.manifest.id, 'admin', approved.manifestHash)
    pluginRegistry.reject(rejected.manifest.id)
    await deactivateAllPlugins()

    expect(urls).toEqual([
      'https://api.example.com/tracked-approved-plugin/activate',
      'https://api.example.com/tracked-rejected-plugin/activate',
      'https://api.example.com/tracked-rejected-plugin/deactivate',
      'https://api.example.com/tracked-approved-plugin/deactivate',
    ])
    expect(pluginRegistry.getEntry(approved.manifest.id)?.state).toBe('approved')
    expect(pluginRegistry.getEntry(rejected.manifest.id)?.state).toBe('rejected')
    expect(getActivatedPluginIds()).toEqual([])
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
        attachmentTransformers: [],
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

  test('deactivation errors do not prevent deterministic teardown of remaining tracked plugins', async () => {
    const firstEntryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate() {},
          deactivate() { globalThis.papaiDeactivateOrder.push('first-ok') },
        }
      }
    `)
    const secondEntryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate() {},
          deactivate() {
            globalThis.papaiDeactivateOrder.push('second-error')
            throw new Error('expected second teardown failure')
          },
        }
      }
    `)
    const first = makePlugin('remaining-after-error', firstEntryPoint)
    const second = makePlugin('error-before-remaining', secondEntryPoint)
    approvePlugin(first)
    approvePlugin(second)
    await activatePlugins([first, second])

    await deactivateAllPlugins()

    expect(globalThis.papaiDeactivateOrder).toEqual(['second-error', 'first-ok'])
    expect(getActivatedPluginIds()).toEqual([])
    expect(contributionRegistry.getContributions(first.manifest.id)).toBeUndefined()
    expect(contributionRegistry.getContributions(second.manifest.id)).toBeUndefined()
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
        attachmentTransformers: [],
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
        attachmentTransformers: [],
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

  test('registers providerConfigValidator from a named plugin module export', async () => {
    const entryPoint = writeTempPluginModule(`
      export async function validateTrackerConfig(config) {
        if (config.baseUrl === 'https://bad.invalid') return { ok: false, reason: 'baseUrl rejected' }
        return { ok: true }
      }

      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('validated-plugin-tracker', { factory: () => ({}) })
          },
        }
      }
    `)
    const plugin = makePlugin('validated-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['validated-plugin-tracker'],
        attachmentTransformers: [],
      },
      providerConfigValidator: 'validateTrackerConfig',
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    const validator = getTaskProviderConfigValidator('validated-plugin-tracker')
    expect(validator).toBeDefined()
    await expect(validator?.({ baseUrl: 'https://bad.invalid' })).resolves.toEqual({
      ok: false,
      reason: 'baseUrl rejected',
    })
  })

  test('validator is wired into the registered provider type without mutating the collected registration object', async () => {
    // Regression guard for refactor: validateConfig must be threaded as a parameter
    // through finalizeSuccessfulActivation → commitTaskProviderRegistration and passed
    // directly to registerContributedTaskProviderType, NOT injected via post-hoc mutation
    // of activationContext.collected.taskProviderRegistration.validateConfig.
    const entryPoint = writeTempPluginModule(`
      export async function validateThreadedConfig(config) {
        return config.apiKey === 'valid-key'
          ? { ok: true }
          : { ok: false, reason: 'apiKey is invalid' }
      }

      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('threaded-validator-tracker', { factory: () => ({}) })
          },
        }
      }
    `)
    const plugin = makePlugin('threaded-validator-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['threaded-validator-tracker'],
        attachmentTransformers: [],
      },
      providerConfigValidator: 'validateThreadedConfig',
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    // The validator must be retrievable and functional — this holds whether
    // the loader threads it as a parameter or injects it via mutation.
    // The test serves as a locked regression guard: any refactor that breaks
    // the threading path will cause this assertion to fail.
    const validator = requireValue(
      getTaskProviderConfigValidator('threaded-validator-tracker'),
      'threaded-validator-tracker config validator',
    )
    await expect(validator({ apiKey: 'valid-key' })).resolves.toEqual({ ok: true })
    await expect(validator({ apiKey: 'wrong-key' })).resolves.toEqual({ ok: false, reason: 'apiKey is invalid' })
    // Plugin must be active — confirm the whole activation path completed cleanly
    expect(
      requireValue(pluginRegistry.getEntry('threaded-validator-plugin'), 'threaded validator registry entry').state,
    ).toBe('active')
  })

  test('keeps API v1 compatibility for object-shaped task provider registration', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('legacy-validated-plugin-tracker', { factory: () => ({}) })
          },
        }
      }
    `)
    const plugin = makePlugin('legacy-validated-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['legacy-validated-plugin-tracker'],
        attachmentTransformers: [],
      },
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    expect(() => createProvider('legacy-validated-plugin-tracker', {})).not.toThrow()
  })

  test('tracks each activated plugin only once', async () => {
    const firstEntryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return { activate() {} }
      }
    `)
    const secondEntryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return { activate() {} }
      }
    `)
    const firstPlugin = makePlugin('activation-order-first', firstEntryPoint)
    const secondPlugin = makePlugin('activation-order-second', secondEntryPoint)
    approvePlugin(firstPlugin)
    approvePlugin(secondPlugin)

    await activatePlugins([firstPlugin, secondPlugin])

    expect(getActivatedPluginIds()).toEqual(['activation-order-first', 'activation-order-second'])
  })

  test('wraps malformed providerConfigValidator returns as validation failures', async () => {
    const entryPoint = writeTempPluginModule(`
      export async function validateTrackerConfig() {
        return { ok: false }
      }

      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('malformed-validator-tracker', { factory: () => ({}) })
          },
        }
      }
    `)
    const plugin = makePlugin('malformed-validator-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['malformed-validator-tracker'],
        attachmentTransformers: [],
      },
      providerConfigValidator: 'validateTrackerConfig',
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    const validator = getTaskProviderConfigValidator('malformed-validator-tracker')
    expect(validator).toBeDefined()
    await expect(validator?.({ baseUrl: 'https://bad.invalid' })).resolves.toEqual({
      ok: false,
      reason:
        "Plugin 'malformed-validator-plugin' providerConfigValidator export 'validateTrackerConfig' returned an invalid result",
    })
  })

  test('marks plugin as error when providerConfigValidator export is not a function', async () => {
    const entryPoint = writeTempPluginModule(`
      export const validateTrackerConfig = 'not a function'

      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('invalid-validator-tracker', { factory: () => ({}) })
          },
        }
      }
    `)
    const plugin = makePlugin('invalid-validator-plugin', entryPoint, {
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['invalid-validator-tracker'],
        attachmentTransformers: [],
      },
      providerConfigValidator: 'validateTrackerConfig',
    })
    approvePlugin(plugin)

    await activatePlugins([plugin])

    expect(pluginRegistry.getEntry('invalid-validator-plugin')?.state).toBe('error')
    expect(getRecentRuntimeEvents('invalid-validator-plugin', 1)[0]?.message).toContain(
      "Plugin 'invalid-validator-plugin' providerConfigValidator export 'validateTrackerConfig' is missing or not a function",
    )
    expect(getTaskProviderConfigValidator('invalid-validator-tracker')).toBeUndefined()
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
        attachmentTransformers: [],
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
        attachmentTransformers: [],
      },
    })
    approvePlugin(plugin)
    insertTaskInstance({ id: 'demo-retire-instance', type: 'demo-retire', config: {}, status: 'active' })

    await activatePlugins([plugin])
    await deactivateAllPlugins({ retireContributedProviders: true })

    expect(requireValue(getTaskInstance('demo-retire-instance'), 'demo retire task instance').status).toBe('stopped')
  })
})
