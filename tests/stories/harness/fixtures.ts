// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { join } from 'node:path'

import { z } from 'zod'

import { saveAttachment } from '../../../src/attachments/store.js'
import { addAuthorizedGroup, setGuestMode } from '../../../src/authorized-groups.js'
import { setMcpPluginServerConfigs } from '../../../src/coding-credentials/mcp-plugin-servers.js'
import { setConfigValue } from '../../../src/config.js'
import { SESSION_COOKIE_NAME as DASHBOARD_SESSION_COOKIE_NAME } from '../../../src/dashboard-auth/cookie.js'
import { addGroupMember } from '../../../src/groups.js'
import { setIdentityMapping } from '../../../src/identity/mapping.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../../../src/instances/admin-store.js'
import { setContextSettings } from '../../../src/instances/context-store.js'
import type { PlatformInstanceType } from '../../../src/instances/types.js'
import { createLlmProvider, setAdminRoleBindings } from '../../../src/llm-providers/store.js'
import { saveMemoryRecord } from '../../../src/long-term-memory/store.js'
import type { MemoryRecord, MemoryRecordInput } from '../../../src/long-term-memory/types.js'
import { mcpPool } from '../../../src/mcp/client-pool.js'
import { saveMemo, updateMemoEmbedding } from '../../../src/memos.js'
import { resetNotifyTokenCacheForTesting } from '../../../src/notify-token.js'
import { discoverPlugins } from '../../../src/plugins/discovery.js'
import { pluginRegistry } from '../../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../../src/plugins/types.js'
import {
  createProvider,
  getTaskProviderDescriptor,
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../../src/providers/registry.js'
import type { TaskProvider } from '../../../src/providers/types.js'
import { issueAuthCode } from '../../../src/settings/auth-code-store.js'
import { SESSION_COOKIE_NAME } from '../../../src/settings/cookies.js'
import { CSRF_HEADER } from '../../../src/settings/request-auth.js'
import { addUser } from '../../../src/users.js'
import { setAssertPublicUrlForTesting } from '../../../src/web/safe-fetch.js'
import {
  seedTestAlertPrompt,
  seedTestConversationHistory,
  seedTestExhaustedWebFetchQuota,
  seedTestMemoryExtractionState,
  seedTestPlatformInstance,
  seedTestRecurringTask,
  seedTestScheduledPrompt,
  seedTestSystemConfig,
  seedTestTaskInstance,
  seedTestUserInstruction,
  setupTestDb,
  type AlertPromptSeed,
  type RecurringTaskSeed,
  type ScheduledPromptSeed,
} from '../../utils/test-helpers.js'
import { MemoryTaskProvider } from './memory-task-provider.js'

export const SCENARIO_PLATFORM_INSTANCE_ID = 'scenario-platform'
export const SCENARIO_TASK_INSTANCE_ID = 'scenario-tasks'
export const SCENARIO_CONTEXT_ID = 'scenario-context'
export const SCENARIO_GROUP_ID = 'scenario-group'
export const SCENARIO_USER_ID = 'scenario-user'
export const SCENARIO_PROVIDER_PLUGIN_ID = 'scenario-memory-provider'

const settingsSessionOwner: unique symbol = Symbol('scenario-settings-session-owner')

export type SettingsSessionHandle = Readonly<{
  kind: 'settings-session'
  principal: Readonly<{ platformInstanceId: string; platformUserId: string }>
  readonly [settingsSessionOwner]: object
}>

type SettingsSessionSecrets = Readonly<{ cookie: string; csrf: string }>

const ExchangeResponseSchema = z.object({ csrfToken: z.string().min(1) })

const extractSessionCookie = (setCookie: string | null): string => {
  const pair = setCookie?.split(';', 1)[0]
  const prefix = `${SESSION_COOKIE_NAME}=`
  if (pair === undefined || !pair.startsWith(prefix) || pair.length === prefix.length) {
    throw new Error(`Missing ${SESSION_COOKIE_NAME} cookie`)
  }
  return pair.slice(prefix.length)
}

export type SettingsSessionVault = Readonly<{
  parseExchange(
    principal: Readonly<{ platformInstanceId: string; platformUserId: string }>,
    response: Response,
  ): Promise<SettingsSessionHandle>
  buildHeaders(session: SettingsSessionHandle, method: string, initial?: HeadersInit, withCsrf?: boolean): Headers
  reset(): void
  revoke(): void
}>

export function createSettingsSessionVault(): SettingsSessionVault {
  const owner = Object.freeze({})
  const secrets = new Map<SettingsSessionHandle, SettingsSessionSecrets>()
  let active = true

  const resolve = (session: SettingsSessionHandle): SettingsSessionSecrets => {
    if (!active) throw new Error('Scenario settings sessions are no longer active')
    if (typeof session !== 'object' || session === null || !Object.hasOwn(session, settingsSessionOwner)) {
      throw new Error('Unknown settings session handle')
    }
    const sessionOwner = session[settingsSessionOwner]
    if (sessionOwner !== owner) throw new Error('Settings session handle belongs to a different scenario world')
    const stored = secrets.get(session)
    if (stored === undefined) throw new Error('Unknown settings session handle')
    return stored
  }

  return {
    async parseExchange(principal, response): Promise<SettingsSessionHandle> {
      if (!active) throw new Error('Scenario settings sessions are no longer active')
      if (response.status !== 200) throw new Error(`Settings auth exchange failed with status ${response.status}`)
      const cookie = extractSessionCookie(response.headers.get('Set-Cookie'))
      const { csrfToken } = ExchangeResponseSchema.parse(await response.json())
      const handle: SettingsSessionHandle = Object.freeze({
        kind: 'settings-session',
        principal: Object.freeze({ ...principal }),
        [settingsSessionOwner]: owner,
      })
      secrets.set(handle, { cookie, csrf: csrfToken })
      return handle
    },
    buildHeaders(session, method, initial, withCsrf = true): Headers {
      const stored = resolve(session)
      const headers = new Headers(initial)
      headers.set('Cookie', `${SESSION_COOKIE_NAME}=${stored.cookie}`)
      const requiresCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
      if (requiresCsrf && withCsrf) headers.set(CSRF_HEADER, stored.csrf)
      else headers.delete(CSRF_HEADER)
      return headers
    },
    reset(): void {
      secrets.clear()
      active = true
    },
    revoke(): void {
      secrets.clear()
      active = false
    },
  }
}

const dashboardSessionOwner: unique symbol = Symbol('scenario-dashboard-session-owner')

export type DashboardSessionHandle = Readonly<{
  kind: 'dashboard-session'
  readonly [dashboardSessionOwner]: object
}>

export type DashboardSessionVault = Readonly<{
  parseClaim(response: Response): Promise<DashboardSessionHandle>
  buildHeaders(session: DashboardSessionHandle, initial?: HeadersInit): Headers
  reset(): void
  revoke(): void
}>

function extractDashboardCookie(setCookie: string | null): string {
  if (setCookie === null) throw new Error('Dashboard claim response had no Set-Cookie header')
  const match = new RegExp(`${DASHBOARD_SESSION_COOKIE_NAME}=([^;]+)`, 'u').exec(setCookie)
  if (match?.[1] === undefined) throw new Error('Dashboard claim response did not set a dashboard_session cookie')
  return match[1]
}

export function createDashboardSessionVault(): DashboardSessionVault {
  const owner = Object.freeze({})
  const cookies = new Map<DashboardSessionHandle, string>()
  let active = true

  const resolve = (session: DashboardSessionHandle): string => {
    if (!active) throw new Error('Scenario dashboard sessions are no longer active')
    if (typeof session !== 'object' || session === null || !Object.hasOwn(session, dashboardSessionOwner)) {
      throw new Error('Unknown dashboard session handle')
    }
    if (session[dashboardSessionOwner] !== owner) {
      throw new Error('Dashboard session handle belongs to a different scenario world')
    }
    const stored = cookies.get(session)
    if (stored === undefined) throw new Error('Unknown dashboard session handle')
    return stored
  }

  return {
    parseClaim(response): Promise<DashboardSessionHandle> {
      if (!active) throw new Error('Scenario dashboard sessions are no longer active')
      if (response.status !== 302) throw new Error(`Dashboard claim failed with status ${response.status}`)
      const cookie = extractDashboardCookie(response.headers.get('Set-Cookie'))
      const handle: DashboardSessionHandle = Object.freeze({
        kind: 'dashboard-session',
        [dashboardSessionOwner]: owner,
      })
      cookies.set(handle, cookie)
      return Promise.resolve(handle)
    },
    buildHeaders(session, initial): Headers {
      const cookie = resolve(session)
      const headers = new Headers(initial)
      headers.set('Cookie', `${DASHBOARD_SESSION_COOKIE_NAME}=${cookie}`)
      return headers
    },
    reset(): void {
      cookies.clear()
      active = true
    },
    revoke(): void {
      cookies.clear()
      active = false
    },
  }
}

const SCENARIO_PLUGIN: DiscoveredPlugin = {
  manifest: {
    id: 'scenario-approved-plugin',
    name: 'Scenario Approved Plugin',
    version: '1.0.0',
    description: 'Hermetic scenario plugin approval fixture',
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
  pluginDir: import.meta.dir,
  entryPoint: join(import.meta.dir, 'scenario-approved-plugin.ts'),
  manifestHash: 'scenario-approved-plugin-hash',
}

export type ScenarioGroupAdminSeed = Readonly<{
  addGroupAdmin(groupId: string, userId: string): void
}>

export type ScenarioFixturesOptions = Readonly<{
  taskProvider?: TaskProvider
  chat?: ScenarioGroupAdminSeed
}>

/** Real, plugin-contributed task provider types the story lane can approve and activate. */
const REAL_TASK_PROVIDER_PLUGIN_IDS: Readonly<Record<'youtrack', string>> = { youtrack: 'task-provider-youtrack' }

export type ScenarioFixtures = Readonly<{
  taskProvider: TaskProvider
  settingsSessions: SettingsSessionVault
  dashboardSessions: DashboardSessionVault
  setupDatabase(): Promise<void>
  seedPlatformInstance(input?: Readonly<{ id?: string; type?: PlatformInstanceType }>): void
  seedTaskInstance(input?: Readonly<{ id?: string; type?: string; config?: Record<string, string> }>): void
  seedRecurringTask(input: RecurringTaskSeed): void
  exhaustWebFetchQuota(input: Readonly<{ actorId: string; nowMs: number }>): void
  seedScheduledPrompt(input: ScheduledPromptSeed): void
  seedAlertPrompt(input: AlertPromptSeed): void
  assignContext(input?: Readonly<{ contextId?: string; platformInstanceId?: string; taskInstanceId?: string }>): void
  authorizeUser(input?: Readonly<{ userId?: string; platformInstanceId?: string; username?: string }>): void
  seedAdmin(input?: Readonly<{ userId?: string; platformInstanceId?: string; superAdmin?: boolean }>): void
  authorizeGroup(input?: Readonly<{ groupId?: string }>): void
  enableGuestMode(groupId: string): void
  addGroupMember(input?: Readonly<{ groupId?: string; userId?: string }>): void
  seedGroupAdmin(input: Readonly<{ groupId: string; userId: string }>): void
  seedIdentity(
    input: Readonly<{
      userId: string
      providerName: string
      providerUserId: string
      login: string
      displayName: string
    }>,
  ): void
  seedSystemLlmConfig(input?: Readonly<{ mainModel?: string }>): void
  seedNotifyToken(token: string): void
  enableMcpPluginServer(platformInstanceId: string, pluginId: string): void
  seedRelayAttachment(
    input: Readonly<{ contextId: string; filename: string; content: string; mimeType?: string }>,
  ): Promise<{ id: string }>
  issueSettingsAuthCode(input: Readonly<{ platformInstanceId: string; platformUserId: string }>, nowMs: number): string
  approvePlugin(plugin?: DiscoveredPlugin): DiscoveredPlugin
  approveRealTaskProviderPlugin(type: 'youtrack'): void
  seedProviderContextConfig(input: Readonly<{ contextId: string; pluginId: string; key: string; value: string }>): void
  registerTaskProvider(): void
  seedMemo(
    input: Readonly<{
      userId: string
      content: string
      tags?: readonly string[]
      summary?: string
      embedding?: readonly number[]
    }>,
  ): { id: string }
  seedMemoryRecord(input: MemoryRecordInput): MemoryRecord
  seedDirtyContext(
    input: Readonly<{
      contextId: string
      contextType: 'dm' | 'group'
      configContextId: string
      messages: readonly Readonly<{ role: 'user' | 'assistant'; content: string }>[]
      lastActivityAt: string
      lastExtractedAt?: string
    }>,
  ): void
  seedInstruction(input: Readonly<{ contextId: string; text: string; id?: string }>): { id: string }
  setPublicBaseUrl(url: string): void
  allowPublicUrl(): void
  teardown(): Promise<void>
}>

export function createScenarioFixtures(options: ScenarioFixturesOptions = {}): ScenarioFixtures {
  const taskProvider = options.taskProvider ?? new MemoryTaskProvider()
  const settingsSessions = createSettingsSessionVault()
  const dashboardSessions = createDashboardSessionVault()
  let nextInstructionId = 0
  let priorPublicBaseUrl: string | undefined
  let publicBaseUrlOverridden = false

  const teardownRegistries = (): void => {
    unregisterContributedTaskProviderType(SCENARIO_PROVIDER_PLUGIN_ID)
    pluginRegistry.clearForTesting()
  }

  const teardown = async (): Promise<void> => {
    await mcpPool.shutdown()
    teardownRegistries()
    settingsSessions.revoke()
    dashboardSessions.revoke()
    if (publicBaseUrlOverridden) {
      if (priorPublicBaseUrl === undefined) Reflect.deleteProperty(process.env, 'SETTINGS_PUBLIC_BASE_URL')
      else process.env['SETTINGS_PUBLIC_BASE_URL'] = priorPublicBaseUrl
      publicBaseUrlOverridden = false
    }
    setAssertPublicUrlForTesting(undefined)
  }

  return {
    taskProvider,
    settingsSessions,
    dashboardSessions,
    async setupDatabase(): Promise<void> {
      teardownRegistries()
      settingsSessions.reset()
      dashboardSessions.reset()
      await setupTestDb()
      resetNotifyTokenCacheForTesting()
    },
    seedPlatformInstance(input = {}): void {
      seedTestPlatformInstance({ id: input.id ?? SCENARIO_PLATFORM_INSTANCE_ID, type: input.type ?? 'telegram' })
    },
    seedTaskInstance(input = {}): void {
      seedTestTaskInstance({
        id: input.id ?? SCENARIO_TASK_INSTANCE_ID,
        type: input.type ?? 'kaneo',
        config: input.config ?? {},
      })
    },
    seedRecurringTask(input): void {
      seedTestRecurringTask(input)
    },
    exhaustWebFetchQuota(input): void {
      seedTestExhaustedWebFetchQuota(input)
    },
    seedScheduledPrompt(input): void {
      seedTestScheduledPrompt(input)
    },
    seedAlertPrompt(input): void {
      seedTestAlertPrompt(input)
    },
    assignContext(input = {}): void {
      setContextSettings({
        contextId: input.contextId ?? SCENARIO_CONTEXT_ID,
        platformInstanceId: input.platformInstanceId ?? SCENARIO_PLATFORM_INSTANCE_ID,
        taskInstanceId: input.taskInstanceId ?? SCENARIO_TASK_INSTANCE_ID,
      })
    },
    authorizeUser(input = {}): void {
      addUser({
        userId: input.userId ?? SCENARIO_USER_ID,
        platformInstanceId: input.platformInstanceId ?? SCENARIO_PLATFORM_INSTANCE_ID,
        addedBy: 'scenario-admin',
        username: input.username,
      })
    },
    seedAdmin(input = {}): void {
      addAdmin(
        input.userId ?? SCENARIO_USER_ID,
        input.superAdmin === true
          ? SUPER_ADMIN_PLATFORM_ID
          : (input.platformInstanceId ?? SCENARIO_PLATFORM_INSTANCE_ID),
      )
    },
    authorizeGroup(input = {}): void {
      addAuthorizedGroup(input.groupId ?? SCENARIO_GROUP_ID, 'scenario-admin')
    },
    enableGuestMode(groupId): void {
      setGuestMode(groupId, true)
    },
    addGroupMember(input = {}): void {
      addGroupMember(input.groupId ?? SCENARIO_GROUP_ID, input.userId ?? SCENARIO_USER_ID, 'scenario-admin')
    },
    seedGroupAdmin(input): void {
      const chat = options.chat
      if (chat === undefined) throw new Error('Scenario fixtures require a chat instance to seed group admins')
      chat.addGroupAdmin(input.groupId, input.userId)
    },
    seedIdentity(input): void {
      setIdentityMapping({
        contextId: input.userId,
        providerName: input.providerName,
        providerUserId: input.providerUserId,
        providerUserLogin: input.login,
        displayName: input.displayName,
        matchMethod: 'manual_nl',
        confidence: 1,
      })
    },
    seedSystemLlmConfig(input = {}): void {
      // Seed a single provider at the scenario LLM host. The small/embedding
      // roles are left null so the resolver falls back to `main`, which keeps
      // every real-HTTP LLM path (secondary chat + embeddings) pointed at
      // https://llm.invalid/v1 — the host the story corpus declares.
      const provider = createLlmProvider(
        { label: 'scenario', providerType: 'openai', baseUrl: 'https://llm.invalid/v1', apiKey: 'scenario-api-key' },
        'scenario-admin',
      )
      setAdminRoleBindings(
        {
          main: { providerId: provider.id, model: input.mainModel ?? 'scenario-main-model' },
          small: null,
          embedding: null,
        },
        'scenario-admin',
      )
    },
    seedNotifyToken(token): void {
      seedTestSystemConfig({ key: 'notify_token', value: token })
    },
    enableMcpPluginServer(platformInstanceId, pluginId): void {
      setMcpPluginServerConfigs(platformInstanceId, [
        { plugin_id: pluginId, enabled: true, default_tool_policy: 'allow' },
      ])
    },
    allowPublicUrl(): void {
      setAssertPublicUrlForTesting(() => Promise.resolve())
    },
    async seedRelayAttachment(input): Promise<{ id: string }> {
      const ref = await saveAttachment({
        contextId: input.contextId,
        sourceProvider: 'unknown',
        sourceMessageId: `relay-${input.filename}`,
        sourceFileId: `file-${input.filename}`,
        filename: input.filename,
        ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
        status: 'available',
        content: Buffer.from(new TextEncoder().encode(input.content)),
      })
      return { id: ref.attachmentId }
    },
    issueSettingsAuthCode(input, nowMs): string {
      return issueAuthCode(input, nowMs)
    },
    approvePlugin(plugin = SCENARIO_PLUGIN): DiscoveredPlugin {
      pluginRegistry.registerDiscovered(plugin)
      const approved = pluginRegistry.approve(plugin.manifest.id, 'scenario-admin', plugin.manifestHash)
      if (!approved) throw new Error(`Failed to approve scenario plugin: ${plugin.manifest.id}`)
      return plugin
    },
    approveRealTaskProviderPlugin(type): void {
      const pluginId = REAL_TASK_PROVIDER_PLUGIN_IDS[type]
      const discovered = discoverPlugins('plugins').plugins.find((plugin) => plugin.manifest.id === pluginId)
      if (discovered === undefined) {
        throw new Error(`Real task provider plugin not discovered on disk: ${pluginId}`)
      }
      pluginRegistry.registerDiscovered(discovered)
      const approved = pluginRegistry.approve(pluginId, 'scenario-admin', discovered.manifestHash)
      if (!approved) throw new Error(`Failed to approve real task provider plugin: ${pluginId}`)
    },
    seedProviderContextConfig(input): void {
      setConfigValue(input.contextId, `plugin:${input.pluginId}:provider:${input.key}`, input.value)
    },
    registerTaskProvider(): void {
      unregisterContributedTaskProviderType(SCENARIO_PROVIDER_PLUGIN_ID)
      registerContributedTaskProviderType('kaneo', {
        pluginId: SCENARIO_PROVIDER_PLUGIN_ID,
        factory: () => taskProvider,
        capabilities: taskProvider.capabilities,
        traits: taskProvider.traits,
        displayName: 'Scenario Memory Provider',
        instanceConfigSchema: [],
        contextConfigSchema: [],
      })
      const descriptor = getTaskProviderDescriptor('kaneo')
      const owner = descriptor?.source === 'builtin' ? 'builtin' : descriptor?.source.plugin
      if (owner !== SCENARIO_PROVIDER_PLUGIN_ID) {
        throw new Error(`Hermetic task provider registration failed: type 'kaneo' is owned by plugin '${owner}'`)
      }
      if (createProvider('kaneo', {}) !== taskProvider) {
        unregisterContributedTaskProviderType(SCENARIO_PROVIDER_PLUGIN_ID)
        throw new Error("Hermetic task provider registration failed: type 'kaneo' did not resolve the world provider")
      }
    },
    seedMemo(input): { id: string } {
      const memo = saveMemo(input.userId, input.content, input.tags ?? [], input.summary)
      if (input.embedding !== undefined) {
        updateMemoEmbedding(input.userId, memo.id, new Float32Array([...input.embedding]))
      }
      return { id: memo.id }
    },
    seedMemoryRecord(input): MemoryRecord {
      return saveMemoryRecord(input)
    },
    seedDirtyContext(input): void {
      seedTestConversationHistory({
        userId: input.contextId,
        messages: JSON.stringify(input.messages.map((message) => ({ role: message.role, content: message.content }))),
      })
      seedTestMemoryExtractionState({
        contextId: input.contextId,
        contextType: input.contextType,
        configContextId: input.configContextId,
        lastActivityAt: input.lastActivityAt,
        ...(input.lastExtractedAt === undefined ? {} : { lastExtractedAt: input.lastExtractedAt }),
      })
    },
    seedInstruction(input): { id: string } {
      nextInstructionId += 1
      const id = input.id ?? `scenario-instruction-${nextInstructionId}`
      seedTestUserInstruction({ id, contextId: input.contextId, text: input.text })
      return { id }
    },
    setPublicBaseUrl(url): void {
      if (!publicBaseUrlOverridden) {
        priorPublicBaseUrl = process.env['SETTINGS_PUBLIC_BASE_URL']
        publicBaseUrlOverridden = true
      }
      process.env['SETTINGS_PUBLIC_BASE_URL'] = url
    },
    teardown,
  }
}
