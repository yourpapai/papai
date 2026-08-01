// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { isAuthorizedGroup } from '../../../src/authorized-groups.js'
import { getConfigValue } from '../../../src/config.js'
import { isGroupMember } from '../../../src/groups.js'
import { isAdmin, isSuperAdmin } from '../../../src/instances/admin-store.js'
import { getContextSettings } from '../../../src/instances/context-store.js'
import { getPlatformInstance } from '../../../src/instances/platform-store.js'
import { getTaskInstance } from '../../../src/instances/task-store.js'
import { getAdminRoleBindings } from '../../../src/llm-providers/store.js'
import { mcpPool } from '../../../src/mcp/client-pool.js'
import { activatePlugins } from '../../../src/plugins/loader.js'
import { pluginRegistry } from '../../../src/plugins/registry.js'
import { getPluginAdminState } from '../../../src/plugins/store.js'
import {
  createProvider,
  getTaskProviderDescriptor,
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../../src/providers/registry.js'
import { TaskProviderResolver } from '../../../src/providers/resolver.js'
import { SESSION_COOKIE_NAME } from '../../../src/settings/cookies.js'
import { CSRF_HEADER } from '../../../src/settings/request-auth.js'
import { isAuthorized } from '../../../src/users.js'
import { createScenarioEvents } from './events.js'
import { createFakeMcpServer } from './fake-mcp-server.js'
import {
  SCENARIO_CONTEXT_ID,
  SCENARIO_GROUP_ID,
  SCENARIO_PLATFORM_INSTANCE_ID,
  SCENARIO_TASK_INSTANCE_ID,
  SCENARIO_USER_ID,
  createScenarioFixtures,
  createSettingsSessionVault,
} from './fixtures.js'
import { MemoryTaskProvider } from './memory-task-provider.js'
import { executeScenario } from './scenario.js'
import { answer, callCapability } from './scripted-llm.js'
import { createStrictHttpDispatcher } from './strict-http.js'

describe('scenario fixtures', () => {
  const fixtures = createScenarioFixtures({ taskProvider: new MemoryTaskProvider() })

  afterEach(async () => {
    await fixtures.teardown()
  })

  test('seeds platform and task instances retrievable through production stores', async () => {
    await fixtures.setupDatabase()
    fixtures.seedPlatformInstance()
    fixtures.seedTaskInstance()

    expect(getPlatformInstance(SCENARIO_PLATFORM_INSTANCE_ID)).toMatchObject({
      id: SCENARIO_PLATFORM_INSTANCE_ID,
      type: 'telegram',
      status: 'active',
    })
    expect(getTaskInstance(SCENARIO_TASK_INSTANCE_ID)).toMatchObject({
      id: SCENARIO_TASK_INSTANCE_ID,
      type: 'kaneo',
      status: 'active',
    })
  })

  test('assigns a context and resolves the world-owned provider through the real resolver', async () => {
    await fixtures.setupDatabase()
    fixtures.seedPlatformInstance()
    fixtures.seedTaskInstance()
    fixtures.assignContext()
    fixtures.registerTaskProvider()

    expect(getContextSettings(SCENARIO_CONTEXT_ID)).toEqual({
      contextId: SCENARIO_CONTEXT_ID,
      platformInstanceId: SCENARIO_PLATFORM_INSTANCE_ID,
      taskInstanceId: SCENARIO_TASK_INSTANCE_ID,
    })
    expect(await new TaskProviderResolver().resolveStrict(SCENARIO_CONTEXT_ID)).toBe(fixtures.taskProvider)
  })

  test('keeps registered descriptor capabilities connected across provider reconfiguration', async () => {
    const provider = new MemoryTaskProvider()
    const configuredFixtures = createScenarioFixtures({ taskProvider: provider })
    await configuredFixtures.setupDatabase()

    try {
      configuredFixtures.registerTaskProvider()
      const descriptor = getTaskProviderDescriptor('kaneo')
      provider.setCapabilities(['comments.read'])

      expect([...descriptor!.capabilities]).toEqual(['comments.read'])
    } finally {
      await configuredFixtures.teardown()
    }
  })

  test('teardown unregisters provider process state and supports repeated lifecycles', async () => {
    await fixtures.setupDatabase()
    fixtures.registerTaskProvider()
    expect(getTaskProviderDescriptor('kaneo')?.source).toEqual({ plugin: 'scenario-memory-provider' })
    await fixtures.teardown()
    await fixtures.teardown()
    expect(getTaskProviderDescriptor('kaneo')).toBeUndefined()
    fixtures.registerTaskProvider()
    expect(getTaskProviderDescriptor('kaneo')).toBeDefined()
  })

  test('fails fast on a foreign provider collision without removing the foreign owner', async () => {
    await fixtures.setupDatabase()
    const foreignProvider = new MemoryTaskProvider()
    registerContributedTaskProviderType('kaneo', {
      pluginId: 'other-owner',
      factory: () => foreignProvider,
      capabilities: foreignProvider.capabilities,
      traits: foreignProvider.traits,
      displayName: 'Other Owner',
      instanceConfigSchema: [],
      contextConfigSchema: [],
    })

    try {
      expect(() => fixtures.registerTaskProvider()).toThrow(
        "Hermetic task provider registration failed: type 'kaneo' is owned by plugin 'other-owner'",
      )
      expect(getTaskProviderDescriptor('kaneo')?.source).toEqual({ plugin: 'other-owner' })
      expect(createProvider('kaneo', {})).toBe(foreignProvider)

      await fixtures.teardown()
      expect(getTaskProviderDescriptor('kaneo')?.source).toEqual({ plugin: 'other-owner' })
      expect(createProvider('kaneo', {})).toBe(foreignProvider)
    } finally {
      unregisterContributedTaskProviderType('other-owner')
    }
  })

  test('seeds authorized users, groups, and group membership through production stores', async () => {
    await fixtures.setupDatabase()
    fixtures.seedPlatformInstance()
    fixtures.authorizeUser()
    fixtures.authorizeGroup()
    fixtures.addGroupMember()

    expect(isAuthorized(SCENARIO_USER_ID, SCENARIO_PLATFORM_INSTANCE_ID)).toBe(true)
    expect(isAuthorizedGroup(SCENARIO_GROUP_ID)).toBe(true)
    expect(isGroupMember(SCENARIO_GROUP_ID, SCENARIO_USER_ID)).toBe(true)
  })

  test('seedAdmin grants platform and super admin roles', async () => {
    await fixtures.setupDatabase()
    fixtures.seedPlatformInstance()

    expect(isAdmin('carol', SCENARIO_PLATFORM_INSTANCE_ID)).toBe(false)
    fixtures.seedAdmin({ userId: 'carol' })
    expect(isAdmin('carol', SCENARIO_PLATFORM_INSTANCE_ID)).toBe(true)
    expect(isSuperAdmin('carol')).toBe(false)
    fixtures.seedAdmin({ userId: 'carol', superAdmin: true })
    expect(isSuperAdmin('carol')).toBe(true)
  })

  test('seeds a complete central LLM configuration', async () => {
    await fixtures.setupDatabase()
    fixtures.seedSystemLlmConfig()

    const bindings = getAdminRoleBindings()
    expect(bindings).not.toBeNull()
    expect(bindings!.main.model).toBe('scenario-main-model')
  })

  test('approves a valid discovered plugin through the real registry and store', async () => {
    await fixtures.setupDatabase()
    const plugin = fixtures.approvePlugin()

    expect(pluginRegistry.getEntry(plugin.manifest.id)?.state).toBe('approved')
    expect(getPluginAdminState(plugin.manifest.id)).toMatchObject({
      pluginId: plugin.manifest.id,
      state: 'approved',
      approvedBy: 'scenario-admin',
      approvedManifestHash: plugin.manifestHash,
    })
  })

  test('a fresh database clears seeded state and registry entries', async () => {
    await fixtures.setupDatabase()
    fixtures.seedPlatformInstance()
    fixtures.approvePlugin()
    await fixtures.setupDatabase()

    expect(getPlatformInstance(SCENARIO_PLATFORM_INSTANCE_ID)).toBeNull()
    expect(pluginRegistry.getAllEntries()).toEqual([])
    expect(getAdminRoleBindings()).toBeNull()
  })

  test('parses an opaque settings session and builds authenticated write headers', async () => {
    const vault = createSettingsSessionVault()
    const session = await vault.parseExchange(
      { platformInstanceId: 'pi-1', platformUserId: 'alice' },
      new Response(JSON.stringify({ csrfToken: 'csrf-secret' }), {
        status: 200,
        headers: { 'Set-Cookie': `${SESSION_COOKIE_NAME}=session-secret; HttpOnly; Path=/settings` },
      }),
    )

    expect(JSON.stringify(session)).not.toContain('secret')
    const headers = vault.buildHeaders(session, 'PATCH', {
      'Content-Type': 'application/json',
      Cookie: 'foreign-session=untrusted',
      [CSRF_HEADER]: 'untrusted-csrf',
    })
    expect(headers.get('Cookie')).toBe(`${SESSION_COOKIE_NAME}=session-secret`)
    expect(headers.get(CSRF_HEADER)).toBe('csrf-secret')
    expect(headers.get('Content-Type')).toBe('application/json')

    const withoutCsrf = vault.buildHeaders(session, 'PATCH', { [CSRF_HEADER]: 'untrusted-csrf' }, false)
    expect(withoutCsrf.has(CSRF_HEADER)).toBe(false)
    expect(vault.buildHeaders(session, 'GET').has(CSRF_HEADER)).toBe(false)
  })

  test('rejects a settings exchange response without the production session cookie', async () => {
    const parsing = createSettingsSessionVault().parseExchange(
      { platformInstanceId: 'pi-1', platformUserId: 'alice' },
      new Response(JSON.stringify({ csrfToken: 'csrf-secret' }), { status: 200 }),
    )

    await expect(parsing).rejects.toThrow(`Missing ${SESSION_COOKIE_NAME} cookie`)
  })

  test('given.groupAdmin marks the member as a group admin for command auth', async () => {
    await executeScenario('group admin fixture', async ({ given, when, then }) => {
      const carol = given.user('carol')
      const team = given.group('team')
      given.member(team, carol)
      given.groupAdmin(team, carol)

      await when.message(carol, team, '/config')

      then.replyIn(team).contains('Open a DM with me and run /config')
    })
  })

  test('given.attachment seeds the relay and upload_attachment consumes it', async () => {
    await executeScenario('attachment relay fixture', async ({ given, when, then }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)
      const instance = given.taskInstance()
      given.assign(dm, instance)
      given.taskCapabilities(['attachments.list', 'attachments.upload'])
      const file = await given.attachment(dm, { filename: 'spec.txt', content: 'hello relay' })
      given.llm([
        callCapability('tasks.create', { projectId: 'proj-1', title: 'Documented' }),
        callCapability('tasks.attachments.upload', { taskId: 'task-1', attachmentId: file.id }),
        answer('Uploaded “spec.txt”.'),
      ])

      await when.message(alice, dm, 'Attach spec.txt to a new task')

      then.replyTo(alice).equals('Uploaded “spec.txt”.')
    })
  })

  test('teardown shuts the MCP pool down so no idle timer leaks', async () => {
    const events = createScenarioEvents('pool-isolation')
    const http = createStrictHttpDispatcher(events)
    const server = createFakeMcpServer({ http, events, url: 'https://mcp.invalid/rpc' })
    server.expectConnect()
    const originalFetch = globalThis.fetch
    Reflect.set(globalThis, 'fetch', http.fetch)
    try {
      await mcpPool.getOrCreateFromUser({ id: 's1', url: 'https://mcp.invalid/rpc', enabled: true })
      expect(mcpPool.getServerInfos().length).toBeGreaterThan(0)

      const scenarioFixtures = createScenarioFixtures()
      await scenarioFixtures.teardown()
      expect(mcpPool.getServerInfos().length).toBe(0)
    } finally {
      Reflect.set(globalThis, 'fetch', originalFetch)
    }
  })
})

describe('approveRealTaskProviderPlugin', () => {
  test('approves the real YouTrack plugin so its type becomes resolvable', async () => {
    const fixtures = createScenarioFixtures({ taskProvider: new MemoryTaskProvider() })
    await fixtures.setupDatabase()

    fixtures.approveRealTaskProviderPlugin('youtrack')
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())

    const descriptor = getTaskProviderDescriptor('youtrack')
    expect(descriptor).toBeDefined()
    expect(descriptor?.source).toEqual({ plugin: 'task-provider-youtrack' })
  })

  test('leaves the kaneo memory-fake registration intact', async () => {
    const fixtures = createScenarioFixtures({ taskProvider: new MemoryTaskProvider() })
    await fixtures.setupDatabase()

    fixtures.approveRealTaskProviderPlugin('youtrack')
    expect(() => {
      fixtures.registerTaskProvider()
    }).not.toThrow()
  })

  test('approves the real Kaneo plugin so its type becomes resolvable without a memory fake', async () => {
    const fixtures = createScenarioFixtures({ taskProvider: new MemoryTaskProvider() })
    await fixtures.setupDatabase()

    fixtures.approveRealTaskProviderPlugin('kaneo')
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())

    const descriptor = getTaskProviderDescriptor('kaneo')
    expect(descriptor).toBeDefined()
    expect(descriptor?.source).toEqual({ plugin: 'task-provider-kaneo' })
  })
})

describe('seedTaskInstance config passthrough', () => {
  test('stores a caller-supplied instance config', async () => {
    const fixtures = createScenarioFixtures({ taskProvider: new MemoryTaskProvider() })
    await fixtures.setupDatabase()
    fixtures.seedTaskInstance({ id: 'ti-1', type: 'youtrack', config: { baseUrl: 'https://youtrack.invalid' } })

    expect(getTaskInstance('ti-1')?.config['baseUrl']).toBe('https://youtrack.invalid')
  })
})

describe('seedProviderContextConfig', () => {
  test('writes the plugin-scoped provider config key the resolver reads', async () => {
    const fixtures = createScenarioFixtures({ taskProvider: new MemoryTaskProvider() })
    await fixtures.setupDatabase()
    fixtures.seedProviderContextConfig({
      contextId: 'ctx-1',
      pluginId: 'task-provider-youtrack',
      key: 'token',
      value: 'fake-token',
    })

    expect(getConfigValue('ctx-1', 'plugin:task-provider-youtrack:provider:token')).toBe('fake-token')
  })
})
