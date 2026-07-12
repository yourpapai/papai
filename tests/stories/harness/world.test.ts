// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getThreadScopedStorageContextId } from '../../../src/auth.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../../../src/instances/admin-store.js'
import { discoverPlugins } from '../../../src/plugins/discovery.js'
import { getActivatedPluginIds } from '../../../src/plugins/loader.js'
import { pluginRegistry, setPluginEnabledForContext } from '../../../src/plugins/registry.js'
import type { DiscoveredPlugin } from '../../../src/plugins/types.js'
import { defaultTaskProviderResolver } from '../../../src/providers/resolver.js'
import { toolCapabilityCatalog } from '../../../src/runtime/capability-catalog.js'
import { DEFAULT_SCHEDULER_TASK_NAMES, scheduler } from '../../../src/scheduler-instance.js'
import { answer, callCapability } from './scripted-llm.js'
import type { DmHandle, GroupHandle, PluginHandle, TaskInstanceHandle, ThreadHandle, UserHandle } from './world.js'
import { createScenarioWorld } from './world.js'

const requireDiscoveredPlugin = (pluginId: string): DiscoveredPlugin => {
  const plugin = discoverPlugins('plugins').plugins.find(({ manifest }) => manifest.id === pluginId)
  if (plugin === undefined) throw new Error(`Missing test plugin: ${pluginId}`)
  return plugin
}

const requireAggregateError = (value: unknown): AggregateError => {
  if (value instanceof AggregateError) return value
  throw new Error('Expected aggregate error')
}

const throwingCleanupObserver =
  (steps: string[], failure: Error): ((kind: string) => void) =>
  (kind): void => {
    steps.push(kind)
    if (kind === 'world.cleanup.plugins.deactivate') throw failure
  }

describe('scenario world', () => {
  test('composes the real runtime path with deterministic scenario boundaries', async () => {
    const world = await createScenarioWorld('real runtime path')

    try {
      expect(world.events.all()).toEqual([])
      expect(world.clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
      expect(world.ids.next('probe')).toBe('probe-1')

      const alice = world.api.given.user('alice')
      const dm = world.api.given.dm(alice)
      const group = world.api.given.group('team')
      const thread = world.api.given.thread(group, 'topic')
      const taskInstance = world.api.given.taskInstance()
      world.api.given.llm([answer('Hello Alice')])

      alice satisfies UserHandle
      dm satisfies DmHandle
      group satisfies GroupHandle
      thread satisfies ThreadHandle
      taskInstance satisfies TaskInstanceHandle

      await world.api.when.message(alice, dm, 'hello')

      world.api.then.replyTo(alice).equals('Hello Alice')
      expect(world.model.inspections()).toHaveLength(1)
      world.verify()
    } finally {
      await world.stop()
    }
  })

  test('seeds canonical scoped ids for real group authorization and task resolution', async () => {
    const world = await createScenarioWorld('scoped ids')

    try {
      const alice = world.api.given.user('alice')
      const group = world.api.given.group('team')
      world.api.given.member(group, alice)
      const dm = world.api.given.dm(alice)
      const taskInstance = world.api.given.taskInstance()
      world.api.given.assign(dm, taskInstance)

      const dmMessage = world.message(alice, dm, 'resolve')
      const scopedDmId = getThreadScopedStorageContextId(
        dmMessage.contextId,
        dmMessage.contextType,
        dmMessage.threadId,
        dmMessage.platformInstanceId,
      )
      expect(await defaultTaskProviderResolver.resolveStrict(scopedDmId)).toBe(world.tasks)

      world.api.given.llm([answer('Authorized group reply')])
      await world.api.when.message(alice, group, 'hello group')
      world.api.then.replyIn(group).equals('Authorized group reply')
    } finally {
      await world.stop()
    }
  })

  test('keeps sibling thread replies isolated while group replies remain unthreaded', async () => {
    const world = await createScenarioWorld('thread replies')

    try {
      const alice = world.api.given.user('alice')
      const group = world.api.given.group('team')
      world.api.given.member(group, alice)
      const first = world.api.given.thread(group, 'first')
      const second = world.api.given.thread(group, 'second')
      world.api.given.llm([answer('First thread'), answer('Second thread'), answer('Main group')])

      await world.api.when.message(alice, first, 'one')
      await world.api.when.message(alice, second, 'two')
      await world.api.when.message(alice, group, 'main')

      world.api.then.replyIn(first).equals('First thread')
      world.api.then.replyIn(second).equals('Second thread')
      world.api.then.replyIn(group).equals('Main group')
      expect(world.repliesForThread(first).every(({ threadId }) => threadId === first.id)).toBe(true)
      expect(world.repliesForThread(first).map(({ content }) => content)).toContain('First thread')
      expect(world.repliesForThread(first).map(({ content }) => content)).not.toContain('Second thread')
      expect(world.repliesForThread(second).every(({ threadId }) => threadId === second.id)).toBe(true)
      expect(world.repliesForThread(second).map(({ content }) => content)).toContain('Second thread')
      expect(world.repliesForThread(second).map(({ content }) => content)).not.toContain('First thread')
    } finally {
      await world.stop()
    }
  })

  test('does not register or run default scheduler tasks when background services are disabled', async () => {
    for (const taskName of DEFAULT_SCHEDULER_TASK_NAMES) expect(scheduler.hasTask(taskName)).toBe(false)
    const world = await createScenarioWorld('no scheduler')

    await world.start()
    for (const taskName of DEFAULT_SCHEDULER_TASK_NAMES) expect(scheduler.hasTask(taskName)).toBe(false)
    expect(world.events.all().some(({ kind }) => kind.startsWith('scheduler.'))).toBe(false)
    await world.stop()
    for (const taskName of DEFAULT_SCHEDULER_TASK_NAMES) expect(scheduler.hasTask(taskName)).toBe(false)
  })

  test('creates sequential worlds without leaking database, tasks, replies, plugins, capabilities, or ids', async () => {
    expect(getActivatedPluginIds()).toEqual([])
    const first = await createScenarioWorld('first')
    const firstDatabase = getDrizzleDb()

    expect(first.ids.next('probe')).toBe('probe-1')
    const alice = first.api.given.user('alice')
    const dm = first.api.given.dm(alice)
    first.api.given.llm([answer('First reply')])
    await first.api.when.message(alice, dm, 'hello')
    first.api.then.replyTo(alice).equals('First reply')
    first.model.verifyConsumed()
    await first.tasks.createTask({ projectId: 'project-1', title: 'First task' })
    await first.stop()

    expect(getActivatedPluginIds()).toEqual([])
    expect(toolCapabilityCatalog.entries()).toEqual([])

    const second = await createScenarioWorld('second')
    try {
      expect(getDrizzleDb()).not.toBe(firstDatabase)
      expect(second.chat.allReplies()).toEqual([])
      expect(second.model.inspections()).toEqual([])
      await second.start()
      expect(second.events.all()).toEqual(second.startupEvents)
      expect(await second.tasks.searchTasks({ query: '' })).toEqual([])
      expect(getActivatedPluginIds()).toEqual([])
      expect(toolCapabilityCatalog.entries()).toEqual(second.capabilityEntriesAtStart)
      expect(second.ids.next('probe')).toBe('probe-1')
    } finally {
      await second.stop()
    }

    expect(getActivatedPluginIds()).toEqual([])
    expect(toolCapabilityCatalog.entries()).toEqual([])
  })

  test('stop is concurrent-safe and idempotent', async () => {
    const world = await createScenarioWorld('idempotent stop')

    await Promise.all([world.start(), world.start()])
    await Promise.all([world.stop(), world.stop()])
    await world.stop()

    expect(world.events.all().filter(({ kind }) => kind === 'world.cleanup.runtime.stop')).toHaveLength(1)
  })

  test('approves discoverable plugin prerequisites before one production activation pass', async () => {
    const world = await createScenarioWorld('plugin prerequisite')
    const plugin = world.api.given.plugin(requireDiscoveredPlugin('synthetic-web-search'))
    plugin satisfies PluginHandle

    expect(getActivatedPluginIds()).toEqual([])
    await Promise.all([world.start(), world.start()])
    expect(getActivatedPluginIds()).toContain(plugin.id)
    expect(() => world.api.given.plugin(requireDiscoveredPlugin('acp'))).toThrow('given.plugin')

    await world.stop()
    expect(getActivatedPluginIds()).toEqual([])
  })

  test('settings approval uses the world-owned HTTP boundary for the full plugin lifecycle', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'papai-scenario-settings-plugin-'))
    const entryPoint = join(directory, 'index.mjs')
    writeFileSync(
      entryPoint,
      `
        export default function createPlugin() {
          let httpFetch
          return {
            async activate(ctx) {
              httpFetch = ctx.providerRuntime.httpFetch
              await httpFetch('https://scenario-plugin.invalid/activate')
              ctx.registration.registerTool({
                name: 'probe',
                capabilityId: 'scenario.lifecycle.probe',
                description: 'Probe the scenario HTTP boundary',
                execute: async () => (await httpFetch('https://scenario-plugin.invalid/tool')).text(),
              })
            },
            deactivate() {
              return httpFetch('https://scenario-plugin.invalid/deactivate')
            },
          }
        }
      `,
    )
    const source = requireDiscoveredPlugin('synthetic-web-search')
    const plugin: DiscoveredPlugin = {
      ...source,
      pluginDir: directory,
      entryPoint,
      manifestHash: 'scenario-settings-http-plugin-hash',
      manifest: {
        ...source.manifest,
        id: 'scenario-settings-http-plugin',
        name: 'Scenario Settings HTTP Plugin',
        contributes: {
          tools: ['probe'],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: [],
          attachmentTransformers: [],
        },
        permissions: ['http'],
        defaultEnabled: false,
        configRequirements: [],
        providerAllowedHosts: ['scenario-plugin.invalid'],
        providerAllowedHostsFromConfig: [],
      },
    }
    const world = await createScenarioWorld('settings activation HTTP ownership')

    try {
      const alice = world.api.given.user('alice')
      const dm = world.api.given.dm(alice)
      addAdmin(alice.id, SUPER_ADMIN_PLATFORM_ID)
      const session = await world.api.given.settingsSession(alice)
      pluginRegistry.registerDiscovered(plugin)
      const contextId = toScopedContextId({
        platformInstanceId: alice.platformInstanceId,
        nativeContextId: alice.id,
      })
      setPluginEnabledForContext(plugin.manifest.id, contextId, true)
      world.http.expect({ method: 'GET', url: 'https://scenario-plugin.invalid/activate' }, () => new Response('ok'))
      world.http.expect({ method: 'GET', url: 'https://scenario-plugin.invalid/tool' }, () => new Response('tool-ok'))
      world.http.expect({ method: 'GET', url: 'https://scenario-plugin.invalid/deactivate' }, () => new Response('ok'))

      const approval = await world.api.when.settingsRequest(session, '/settings/api/admin/plugin-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: plugin.manifest.id, action: 'approve' }),
      })
      expect(approval.status).toBe(200)
      expect(pluginRegistry.getEntry(plugin.manifest.id)?.state).toBe('active')

      world.api.given.llm([callCapability('scenario.lifecycle.probe', {}), answer('Plugin request completed.')])
      await world.api.when.message(alice, dm, 'Run the plugin probe')
      world.api.then.replyTo(alice).equals('Plugin request completed.')

      const rejection = await world.api.when.settingsRequest(session, '/settings/api/admin/plugin-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: plugin.manifest.id, action: 'reject' }),
      })
      expect(rejection.status).toBe(200)
      world.verify()
    } finally {
      await world.stop()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('aggregates startup failure first and attempts every applicable cleanup step', async () => {
    const cleanupSteps: string[] = []
    const startupFailure = new Error('injected startup failure')
    const world = await createScenarioWorld('startup failure', {
      testHooks: {
        afterProductionExtensionsStart: () => {
          throw startupFailure
        },
        onCleanupStep: (kind): void => {
          cleanupSteps.push(kind)
        },
      },
    })
    world.http.expect({ method: 'GET', url: 'https://leftover.invalid/' }, () => new Response('unused'))

    const failure = await world.start().then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(AggregateError)
    const aggregate = requireAggregateError(failure)
    expect(aggregate.errors[0]).toBe(startupFailure)
    expect(String(aggregate.errors[1])).toContain('unconsumed HTTP expectations')
    expect(cleanupSteps).toEqual([
      'world.cleanup.runtime.stop',
      'world.cleanup.plugins.deactivate',
      'world.cleanup.provider.unregister',
      'world.cleanup.database.reset',
      'world.cleanup.http.verify',
      'world.cleanup.model.verify',
    ])
  })

  test('cleans partial database setup when world construction fails', async () => {
    const cleanupSteps: string[] = []
    const setupFailure = new Error('injected setup failure')

    const failure = await createScenarioWorld('setup failure', {
      testHooks: {
        afterDatabaseSetup: () => {
          throw setupFailure
        },
        onCleanupStep: (kind): void => {
          cleanupSteps.push(kind)
        },
      },
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toBe(setupFailure)
    expect(cleanupSteps).toEqual([
      'world.cleanup.plugins.deactivate',
      'world.cleanup.database.reset',
      'world.cleanup.http.verify',
      'world.cleanup.model.verify',
    ])
  })

  test('continues cleanup when the cleanup observer throws', async () => {
    const cleanupSteps: string[] = []
    const observerFailure = new Error('observer failed')
    const world = await createScenarioWorld('cleanup observer', {
      testHooks: {
        onCleanupStep: throwingCleanupObserver(cleanupSteps, observerFailure),
      },
    })
    await world.start()

    await expect(world.stop()).rejects.toThrow('observer failed')
    expect(cleanupSteps).toEqual([
      'world.cleanup.runtime.stop',
      'world.cleanup.plugins.deactivate',
      'world.cleanup.provider.unregister',
      'world.cleanup.database.reset',
      'world.cleanup.http.verify',
      'world.cleanup.model.verify',
    ])
    expect(world.events.all().some(({ kind }) => kind === 'chat.stop')).toBe(true)
  })
})
