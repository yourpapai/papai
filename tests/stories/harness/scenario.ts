// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import {
  setGroupAnnounceSubscribed,
  setUserAnnounceSubscribed,
  upsertAnnouncementDraft,
} from '../../../src/announcements/store.js'
import { getThreadScopedStorageContextId } from '../../../src/auth.js'
import { getCachedHistory } from '../../../src/cache.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { setMcpCatalog } from '../../../src/coding-credentials/mcp-catalog.js'
import { serializeMcpSelections } from '../../../src/coding-credentials/mcp-selections.js'
import { updateCodingCredentials } from '../../../src/coding-credentials/store.js'
import { upsertRepo } from '../../../src/coding-repos/store.js'
import { configureCodingSessionCapability } from '../../../src/coding-sessions/configure.js'
import {
  getCodingSessionRecord,
  setCodingSessionRecord,
  type SessionRecord,
} from '../../../src/coding-sessions/store.js'
import { issueClaim } from '../../../src/dashboard-auth/index.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { announcementDeliveries, memoryRecords } from '../../../src/db/schema.js'
import { pollAlertsOnce, pollScheduledOnce } from '../../../src/deferred-prompts/poller.js'
import { sweepDirtyContexts, type SweepDeps } from '../../../src/long-term-memory/capture-sweep.js'
import { runMemoryCapture, type RunMemoryCaptureDeps } from '../../../src/long-term-memory/capture.js'
import { DEFAULT_IDLE_MS } from '../../../src/long-term-memory/extraction-state.js'
import type { MemoryPatch } from '../../../src/long-term-memory/extractor.js'
import { sweepPromotions, type SweepPromotionsDeps } from '../../../src/long-term-memory/promotion-sweep.js'
import { evaluatePromotion } from '../../../src/long-term-memory/promotion.js'
import type {
  MemoryEvidence,
  MemoryKind,
  MemoryRecord,
  MemoryRecordInput,
  MemoryScope,
  MemoryScopeType,
  MemorySource,
  MemoryStatus,
} from '../../../src/long-term-memory/types.js'
import { kvList } from '../../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../../src/plugins/types.js'
import { defaultTaskProviderResolver } from '../../../src/providers/resolver.js'
import type { TaskCapability, TaskProvider } from '../../../src/providers/types.js'
import { tick } from '../../../src/scheduler.js'
import { setToolPrefs, type ToolPrefs } from '../../../src/tools/tool-preferences.js'
import type { ScenarioProactiveDeliveryPlan } from './chat.js'
import { MATCH_EMBEDDING } from './embeddings.js'
import {
  SCENARIO_PLATFORM_INSTANCE_ID,
  type DashboardSessionHandle,
  type RealTaskProviderType,
  type SettingsSessionHandle,
} from './fixtures.js'
import { runWithScenarioIoGuard } from './io-guard.js'
import type { ScenarioRuntimeExtension } from './runtime-extension.js'
import type { ModelDecision } from './scripted-llm.js'
import {
  ADMIN_USER_ID,
  REAL_KANEO_BASE_URL,
  REAL_KANEO_CREDENTIAL,
  REAL_KANEO_WORKSPACE_ID,
  REAL_YOUTRACK_BASE_URL,
  REAL_YOUTRACK_TOKEN,
  type ContextHandle,
  type DmHandle,
  type GroupHandle,
  type PluginHandle,
  type ScenarioWorld,
  type TaskInstanceHandle,
  type ThreadHandle,
  type UserHandle,
  interactionForContext,
  makeDmHandle,
  makeGroupHandle,
  makePluginHandle,
  makeTaskInstanceHandle,
  makeThreadHandle,
  makeUserHandle,
  messageForContext,
  repliesForContext,
  repliesForThread,
} from './world.js'

const codingSessionHandleBrand: unique symbol = Symbol('scenario-coding-session')

type CodingMcpCatalogEntry = Readonly<{
  name: string
  upstreamUrl: string
  header?: string
  defaultToolPolicy: 'allow' | 'ask' | 'deny'
  toolPolicy?: Readonly<Record<string, 'allow' | 'ask' | 'deny'>>
}>

type CodingMcpSelection = Readonly<{ server: string; upstreamToken?: string }>

type CodingMcpConfig =
  | Readonly<{
      context: ContextHandle
      updatedBy: string
      catalog: readonly CodingMcpCatalogEntry[]
      selections: readonly CodingMcpSelection[]
      malformedSettings?: never
    }>
  | Readonly<{
      context: ContextHandle
      updatedBy: string
      catalog: readonly CodingMcpCatalogEntry[]
      selections?: never
      malformedSettings: string
    }>

export type CodingSessionHandle = Readonly<{
  kind: 'coding-session'
  capabilityId: 'coding-session.start'
  contextId: string
  readonly [codingSessionHandleBrand]: true
}>

export type AttachmentHandle = Readonly<{ id: string }>

type ScenarioGiven = Readonly<{
  user(id: string): UserHandle
  guest(id: string): UserHandle
  group(id: string): GroupHandle
  guestMode(group: GroupHandle, enabled: true): void
  member(group: GroupHandle, user: UserHandle): void
  groupAdmin(group: GroupHandle, user: UserHandle): void
  identity(
    user: UserHandle,
    identity: Readonly<{ providerUserId: string; login: string; displayName: string }>,
    providerName?: string,
  ): void
  providerUser(identity: Readonly<{ id: string; login: string; name?: string }>): void
  dm(user: UserHandle): DmHandle
  thread(group: GroupHandle, id: string): ThreadHandle
  announcementSubscription(context: DmHandle | GroupHandle, enabled: boolean): void
  announcementDraft(input: Readonly<{ version: string; body: string }>): void
  proactiveDelivery(plans: readonly ScenarioProactiveDeliveryPlan[]): void
  attachment(
    context: ContextHandle,
    file: Readonly<{ filename: string; content: string; mimeType?: string }>,
  ): Promise<AttachmentHandle>
  taskInstance(id?: string, providerType?: string): TaskInstanceHandle
  taskCapabilities(capabilities: readonly TaskCapability[]): void
  assign(context: ContextHandle, taskInstance: TaskInstanceHandle): void
  toolPrefs(context: ContextHandle, prefs: ToolPrefs): void
  settingsSession(user: UserHandle): Promise<SettingsSessionHandle>
  dashboardSession(): Promise<DashboardSessionHandle>
  admin(user: UserHandle, options?: Readonly<{ superAdmin?: boolean }>): void
  settingsAdminSession(user: UserHandle, options?: Readonly<{ superAdmin?: boolean }>): Promise<SettingsSessionHandle>
  plugin(plugin: DiscoveredPlugin): PluginHandle
  codingSession(
    config: Readonly<{
      pluginDirectory: string
      context: ContextHandle
      magiBaseUrl: string
      magiToken: string
      updatedBy: string
    }>,
  ): CodingSessionHandle
  codingCredentials(
    config: Readonly<{
      context: ContextHandle
      updatedBy: string
      agentProvider?: Readonly<{
        agent: string
        provider: 'anthropic' | 'openai' | 'openai-compatible'
        apiKey: string
      }>
      forge?: Readonly<{ kind: 'github' | 'gitlab'; token: string }>
    }>,
  ): void
  codingMcp(config: CodingMcpConfig): void
  codingProject(
    config: Readonly<{
      context: ContextHandle
      updatedBy: string
      name: string
      repoUrl: string
      baseBranch?: string
      permissionPreset?: 'autonomous' | 'cautious' | 'readonly'
      additionalEgressDomains?: readonly string[]
    }>,
  ): void
  knownCodingSession(context: ContextHandle, sessionId: string, record: SessionRecord): void
  runtimeExtension(extension: ScenarioRuntimeExtension): void
  llm(decisions: readonly ModelDecision[]): void
  memo(
    input: Readonly<{
      userId: string
      content: string
      tags?: readonly string[]
      summary?: string
      embedding?: readonly number[]
    }>,
  ): { id: string }
  memoryRecord(
    input: Readonly<{
      scope: Readonly<{ scopeId: string; scopeType: MemoryScopeType }>
      kind: MemoryKind
      content: string
      status?: MemoryStatus
      source?: MemorySource
      summary?: string | null
      tags?: readonly string[]
      confidence?: number
      threadContextId?: string
      evidence?: MemoryEvidence
      id?: string
      createdAt?: string
      updatedAt?: string
      lastSeenAt?: string
      embedding?: readonly number[]
    }>,
  ): MemoryRecord
  dirtyContext(
    context: ContextHandle,
    input: Readonly<{
      messages: readonly Readonly<{ role: 'user' | 'assistant'; content: string }>[]
      lastActivityAt: string
      lastExtractedAt?: string
    }>,
  ): void
  instruction(context: ContextHandle, text: string, id?: string): { id: string }
  notifyToken(token: string): void
  mcpPluginServer(platformInstanceId: string, pluginId: string): void
  publicBaseUrl(url: string): void
  allowPublicUrl(): void
  exhaustedWebFetchQuota(context: ContextHandle): void
  recurringTask(
    context: ContextHandle,
    input: Readonly<{
      title: string
      projectId?: string
      nextRun: string
      id?: string
      rrule?: string
      dtstartUtc?: string
      enabled?: '0' | '1'
    }>,
  ): { id: string; userId: string }
  scheduledPrompt(
    context: ContextHandle,
    input: Readonly<{ prompt: string; fireAt: string; id?: string; executionMetadata?: string }>,
  ): { id: string }
  alertPrompt(
    context: ContextHandle,
    input: Readonly<{ prompt: string; condition: unknown; id?: string }>,
  ): { id: string }
}>

type ScenarioWhen = Readonly<{
  message(user: UserHandle, context: ContextHandle, text: string): Promise<void>
  dispatchMessage(user: UserHandle, context: ContextHandle, text: string): Promise<void>
  interaction(user: UserHandle, context: ContextHandle, callbackData: string): Promise<void>
  settingsSession(user: UserHandle): Promise<SettingsSessionHandle>
  request(path: string, init?: RequestInit): Promise<Response>
  dashboardRequest(session: DashboardSessionHandle, path: string, init?: RequestInit): Promise<Response>
  settingsRequest(
    session: SettingsSessionHandle,
    path: string,
    init?: RequestInit,
    options?: Readonly<{ csrf?: boolean }>,
  ): Promise<Response>
  captureSweep(
    input?: Readonly<{
      records?: readonly CaptureSweepRecord[]
      now?: string
      idleMs?: number
      getEmbedding?: (text: string, configContextId: string) => Promise<number[] | null>
    }>,
  ): Promise<void>
  recurringTick(): Promise<void>
  startScheduler(): Promise<void>
  scheduledPoll(): Promise<void>
  alertPoll(): Promise<void>
  promotionSweep(
    input?: Readonly<{ confirmDurable?: (content: string, configContextId: string) => Promise<boolean>; now?: string }>,
  ): Promise<void>
}>

type ReplyAssertion = Readonly<{ equals(expected: string): void; contains(expected: string): void }>
type ReplyHistoryAssertion = Readonly<{ equal(expected: readonly string[]): void }>
type TaskAssertion = Readonly<{ exists(): Promise<void>; absent(): Promise<void> }>
type CodingSessionAssertion = Readonly<{
  matches(expected: Partial<SessionRecord>): void
  equals(expected: SessionRecord): void
  absent(): void
}>
type CodingSessionsAssertion = Readonly<{
  count(expected: number): void
  session(sessionId: string): CodingSessionAssertion
}>

type ResponseJsonAssertion = Readonly<{ contains(needle: string): void; equals(expected: unknown): void }>
type ProactiveAttemptsAssertion = Readonly<{ equal(expectedContextIds: readonly string[]): void }>
type AnnouncementDelivery = Readonly<{
  contextId: string
  contextType: 'dm' | 'group'
  status: 'sent' | 'failed'
}>
type AnnouncementDeliveriesAssertion = Readonly<{ equal(expected: readonly AnnouncementDelivery[]): void }>

type ScenarioThen = Readonly<{
  replyTo(user: UserHandle): ReplyAssertion
  repliesTo(user: UserHandle): ReplyHistoryAssertion
  replyIn(context: ContextHandle): ReplyAssertion
  proactiveAttempts(): ProactiveAttemptsAssertion
  announcementDeliveries(version: string): AnnouncementDeliveriesAssertion
  codingSessions(context: ContextHandle): CodingSessionsAssertion
  task(title: string): TaskAssertion
  responseStatus(response: Response, expected: number): void
  responseJson(body: unknown): ResponseJsonAssertion
}>

export type ScenarioApi = Readonly<{
  given: ScenarioGiven
  when: ScenarioWhen
  then: ScenarioThen
  world: ScenarioWorld
  resolveRealTaskProvider(context: ContextHandle): Promise<TaskProvider>
}>

type WorldFactory = (name: string) => Promise<ScenarioWorld>

export type ScenarioOptions = Readonly<{ debugEnabled?: boolean; realTaskProvider?: RealTaskProviderType }>

const contextId = (context: ContextHandle): string =>
  context.kind === 'dm' ? context.user.id : context.kind === 'thread' ? context.group.id : context.id

const scopedConfigContextId = (context: ContextHandle): string =>
  toScopedContextId({ platformInstanceId: context.platformInstanceId, nativeContextId: contextId(context) })

const scopedStorageContextId = (context: ContextHandle): string =>
  getThreadScopedStorageContextId(
    contextId(context),
    context.kind === 'dm' ? 'dm' : 'group',
    context.kind === 'thread' ? context.id : undefined,
    context.platformInstanceId,
  )

const scopedGroupId = (group: GroupHandle): string =>
  toScopedContextId({ platformInstanceId: group.platformInstanceId, nativeContextId: group.id })

/** Fixed reference instant for sweep-trigger primitives; scenarios seed activity timestamps relative to this. */
export const FIXED_SWEEP_NOW = '2026-07-20T00:00:00.000Z'

/** A candidate captured-memory record for `when.captureSweep`; `source`/timestamps are filled in internally. */
export type CaptureSweepRecord = Readonly<{
  kind: MemoryKind
  content: string
  summary?: string | null
  tags?: readonly string[]
  confidence?: number
  evidence?: MemoryEvidence
}>

/** Replica of `promotion-sweep.ts`'s private `defaultListScopes` (not exported by production code). */
const defaultPromotionScopes = (): readonly MemoryScope[] => {
  const rows = getDrizzleDb()
    .selectDistinct({ scopeId: memoryRecords.scopeId, scopeType: memoryRecords.scopeType })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.status, 'provisional'), eq(memoryRecords.scopeType, 'group')))
    .all()
  return rows.map((row) => ({ scopeId: row.scopeId, scopeType: row.scopeType }))
}

const makeCodingSessionHandle = (storageContextId: string): CodingSessionHandle =>
  Object.freeze({
    kind: 'coding-session',
    capabilityId: 'coding-session.start',
    contextId: storageContextId,
    [codingSessionHandleBrand]: true as const,
  })

const scenarioUrl = (path: string): URL => new URL(path, 'https://scenario.invalid')

function settingsUrl(world: ScenarioWorld, path: string): URL {
  const hasSettingsBoundary = path === '/settings' || path.startsWith('/settings/') || path.startsWith('/settings?')
  const rawPathname = path.split(/[?#]/u, 1)[0] ?? ''
  const hasEncodedSeparator = /%(?:2f|5c)/iu.test(rawPathname)
  if (!hasSettingsBoundary || path.includes('\\') || hasEncodedSeparator) {
    throw new Error(world.events.formatFailure('Unsafe settings request path'))
  }
  let url: URL
  try {
    url = scenarioUrl(path)
  } catch (error) {
    throw new Error(world.events.formatFailure('Unsafe settings request path'), { cause: error })
  }
  const validPath = url.pathname === '/settings' || url.pathname.startsWith('/settings/')
  if (url.origin !== 'https://scenario.invalid' || !validPath) {
    throw new Error(world.events.formatFailure('Unsafe settings request path'))
  }
  return url
}

type SettingsRequestAuth = Readonly<{ session: SettingsSessionHandle; withCsrf: boolean }>

async function runtimeRequest(
  world: ScenarioWorld,
  path: string,
  init: RequestInit = {},
  settingsAuth?: SettingsRequestAuth,
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const url = settingsAuth === undefined ? scenarioUrl(path) : settingsUrl(world, path)
  const headers =
    settingsAuth === undefined
      ? new Headers(init.headers)
      : world.fixtures.settingsSessions.buildHeaders(settingsAuth.session, method, init.headers, settingsAuth.withCsrf)
  await world.ensureStarted()
  world.events.record('settings.request', { method, url, headers, hasBody: init.body !== undefined })
  const response = await world.runtime.request(new Request(url, { ...init, method, headers }))
  world.events.record('settings.response', { method, url, status: response.status, headers: response.headers })
  return response
}

async function createSettingsSession(world: ScenarioWorld, user: UserHandle): Promise<SettingsSessionHandle> {
  const principal = { platformInstanceId: user.platformInstanceId, platformUserId: user.id }
  const code = world.fixtures.issueSettingsAuthCode(principal, world.clock.now().getTime())
  const response = await runtimeRequest(world, '/settings/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  return world.fixtures.settingsSessions.parseExchange(principal, response)
}

async function createDashboardSession(world: ScenarioWorld): Promise<DashboardSessionHandle> {
  const claim = issueClaim(ADMIN_USER_ID, SCENARIO_PLATFORM_INSTANCE_ID)
  const response = await runtimeRequest(world, '/auth/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ n: claim.nonce }).toString(),
  })
  return world.fixtures.dashboardSessions.parseClaim(response)
}

function tracedAssertion(world: ScenarioWorld, assertion: () => void): void {
  try {
    assertion()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(world.events.formatFailure(message), { cause: error })
  }
}

function replyAssertion(world: ScenarioWorld, replies: () => readonly { content?: string }[]): ReplyAssertion {
  return {
    equals(expected): void {
      const captured = replies().filter(({ content }) => content !== undefined)
      tracedAssertion(world, () => expect(captured.at(-1)?.content).toBe(expected))
    },
    contains(expected): void {
      const captured = replies().filter(({ content }) => content !== undefined)
      tracedAssertion(world, () => expect(captured.at(-1)?.content).toContain(expected))
    },
  }
}

function replyHistoryAssertion(
  world: ScenarioWorld,
  replies: () => readonly { kind: string; content?: string }[],
): ReplyHistoryAssertion {
  return {
    equal(expected): void {
      const captured = replies().flatMap(({ content, kind }) =>
        content === undefined || !['formatted', 'text', 'replace-text', 'buttons'].includes(kind) ? [] : [content],
      )
      tracedAssertion(world, () => expect(captured).toEqual([...expected]))
    },
  }
}

function codingSessionsAssertion(world: ScenarioWorld, context: ContextHandle): CodingSessionsAssertion {
  const storageContextId = scopedConfigContextId(context)
  const recordFor = (sessionId: string): SessionRecord | null => getCodingSessionRecord(storageContextId, sessionId)
  return {
    count(expected): void {
      tracedAssertion(world, () => expect(kvList('acp', storageContextId, 'session:')).toHaveLength(expected))
    },
    session(sessionId): CodingSessionAssertion {
      return {
        matches(expected): void {
          tracedAssertion(world, () => expect(recordFor(sessionId)).toMatchObject(expected))
        },
        equals(expected): void {
          tracedAssertion(world, () => expect(recordFor(sessionId)).toEqual(expected))
        },
        absent(): void {
          tracedAssertion(world, () => expect(recordFor(sessionId)).toBeNull())
        },
      }
    },
  }
}

function createGiven(world: ScenarioWorld): ScenarioGiven {
  const prerequisite = (operation: string): void => {
    world.events.setPhase(operation)
    world.assertPrerequisitesOpen(operation)
  }
  const seedAdminRole = (user: UserHandle, options?: Readonly<{ superAdmin?: boolean }>): void => {
    world.fixtures.seedAdmin({
      userId: user.id,
      platformInstanceId: user.platformInstanceId,
      superAdmin: options?.superAdmin ?? false,
    })
  }
  return {
    user(id): UserHandle {
      prerequisite('given.user')
      world.fixtures.authorizeUser({ userId: id, platformInstanceId: SCENARIO_PLATFORM_INSTANCE_ID, username: id })
      return makeUserHandle(id)
    },
    guest(id): UserHandle {
      prerequisite('given.guest')
      return makeUserHandle(id)
    },
    group(id): GroupHandle {
      prerequisite('given.group')
      const group = makeGroupHandle(id)
      world.fixtures.authorizeGroup({ groupId: scopedGroupId(group) })
      return group
    },
    guestMode(group, enabled): void {
      prerequisite('given.guestMode')
      if (enabled) world.fixtures.enableGuestMode(scopedGroupId(group))
    },
    member(group, user): void {
      prerequisite('given.member')
      world.fixtures.addGroupMember({ groupId: scopedGroupId(group), userId: user.id })
    },
    groupAdmin(group, user): void {
      prerequisite('given.groupAdmin')
      world.fixtures.seedGroupAdmin({ groupId: scopedGroupId(group), userId: user.id })
    },
    identity(user, identity, providerName = 'kaneo'): void {
      prerequisite('given.identity')
      world.fixtures.seedIdentity({ userId: user.id, providerName, ...identity })
    },
    providerUser(identity): void {
      prerequisite('given.providerUser')
      world.tasks.addIdentityUser(identity)
    },
    dm: makeDmHandle,
    thread: makeThreadHandle,
    announcementSubscription(context, enabled): void {
      prerequisite('given.announcementSubscription')
      if (context.kind === 'dm') {
        setUserAnnounceSubscribed(context.platformInstanceId, context.user.id, enabled)
        return
      }
      setGroupAnnounceSubscribed(scopedGroupId(context), enabled)
    },
    announcementDraft({ version, body }): void {
      prerequisite('given.announcementDraft')
      upsertAnnouncementDraft({ version, rawBody: body, humanizedBody: body })
    },
    proactiveDelivery(plans): void {
      prerequisite('given.proactiveDelivery')
      world.chat.configureProactiveDelivery(plans)
    },
    attachment(context, file): Promise<AttachmentHandle> {
      prerequisite('given.attachment')
      return world.fixtures.seedRelayAttachment({ contextId: scopedStorageContextId(context), ...file })
    },
    taskInstance(id = world.ids.next('task-instance'), providerType = 'kaneo'): TaskInstanceHandle {
      prerequisite('given.taskInstance')
      world.fixtures.seedTaskInstance({
        id,
        type: providerType,
        config:
          providerType === 'youtrack'
            ? { baseUrl: REAL_YOUTRACK_BASE_URL }
            : providerType === 'kaneo'
              ? { baseUrl: REAL_KANEO_BASE_URL }
              : {},
      })
      return makeTaskInstanceHandle(id, providerType)
    },
    taskCapabilities(capabilities): void {
      prerequisite('given.taskCapabilities')
      world.tasks.setCapabilities(capabilities)
    },
    assign(context, taskInstance): void {
      prerequisite('given.assign')
      world.fixtures.assignContext({
        contextId: scopedConfigContextId(context),
        platformInstanceId: context.platformInstanceId,
        taskInstanceId: taskInstance.id,
      })
      if (taskInstance.providerType === 'youtrack') {
        world.fixtures.seedProviderContextConfig({
          contextId: scopedConfigContextId(context),
          pluginId: 'task-provider-youtrack',
          key: 'token',
          value: REAL_YOUTRACK_TOKEN,
        })
      }
      if (taskInstance.providerType === 'kaneo') {
        world.fixtures.seedProviderContextConfig({
          contextId: scopedConfigContextId(context),
          pluginId: 'task-provider-kaneo',
          key: 'credential',
          value: REAL_KANEO_CREDENTIAL,
        })
        world.fixtures.seedProviderContextConfig({
          contextId: scopedConfigContextId(context),
          pluginId: 'task-provider-kaneo',
          key: 'workspaceId',
          value: REAL_KANEO_WORKSPACE_ID,
        })
      }
    },
    settingsSession(user): Promise<SettingsSessionHandle> {
      prerequisite('given.settingsSession')
      return createSettingsSession(world, user)
    },
    dashboardSession(): Promise<DashboardSessionHandle> {
      world.events.setPhase('given.dashboardSession')
      return createDashboardSession(world)
    },
    toolPrefs(context, prefs): void {
      prerequisite('given.toolPrefs')
      setToolPrefs(scopedConfigContextId(context), prefs)
    },
    admin(user, options): void {
      prerequisite('given.admin')
      seedAdminRole(user, options)
    },
    settingsAdminSession(user, options): Promise<SettingsSessionHandle> {
      prerequisite('given.settingsAdminSession')
      seedAdminRole(user, options)
      return createSettingsSession(world, user)
    },
    plugin(plugin): PluginHandle {
      prerequisite('given.plugin')
      const approved = world.fixtures.approvePlugin(plugin)
      return makePluginHandle(approved)
    },
    codingSession(config): CodingSessionHandle {
      prerequisite('given.codingSession')
      const configContextId = scopedConfigContextId(config.context)
      configureCodingSessionCapability({
        pluginDirectory: config.pluginDirectory,
        contextId: configContextId,
        magiBaseUrl: config.magiBaseUrl,
        magiToken: config.magiToken,
        updatedBy: config.updatedBy,
      })
      return makeCodingSessionHandle(configContextId)
    },
    codingCredentials(config): void {
      prerequisite('given.codingCredentials')
      const storageContextId = scopedConfigContextId(config.context)
      if (config.agentProvider !== undefined) {
        updateCodingCredentials(
          storageContextId,
          'agent-provider',
          {
            agent: config.agentProvider.agent,
            provider: config.agentProvider.provider,
            provider_api_key: config.agentProvider.apiKey,
          },
          config.updatedBy,
        )
      }
      if (config.forge !== undefined) {
        updateCodingCredentials(
          storageContextId,
          'forge',
          { kind: config.forge.kind, forge_token: config.forge.token },
          config.updatedBy,
        )
      }
    },
    codingMcp(config): void {
      prerequisite('given.codingMcp')
      setMcpCatalog(
        config.context.platformInstanceId,
        config.catalog.map((entry) => ({
          name: entry.name,
          upstream_url: entry.upstreamUrl,
          ...(entry.header === undefined ? {} : { header: entry.header }),
          default_tool_policy: entry.defaultToolPolicy,
          ...(entry.toolPolicy === undefined ? {} : { tool_policy: { ...entry.toolPolicy } }),
        })),
      )
      updateCodingCredentials(
        scopedConfigContextId(config.context),
        'mcp',
        {
          servers:
            config.malformedSettings ??
            serializeMcpSelections(
              config.selections.map((selection) => ({
                server: selection.server,
                ...(selection.upstreamToken === undefined ? {} : { upstream_token: selection.upstreamToken }),
              })),
            ),
        },
        config.updatedBy,
      )
    },
    codingProject(config): void {
      prerequisite('given.codingProject')
      upsertRepo(
        scopedConfigContextId(config.context),
        {
          name: config.name,
          repoUrl: config.repoUrl,
          baseBranch: config.baseBranch ?? 'main',
          permissionPreset: config.permissionPreset ?? 'cautious',
          ...(config.additionalEgressDomains === undefined
            ? {}
            : { additionalEgressDomains: [...config.additionalEgressDomains] }),
        },
        config.updatedBy,
      )
    },
    knownCodingSession(context, sessionId, record): void {
      prerequisite('given.knownCodingSession')
      setCodingSessionRecord(scopedConfigContextId(context), sessionId, record)
    },
    runtimeExtension(extension): void {
      prerequisite('given.runtimeExtension')
      world.registerRuntimeExtension(extension)
    },
    llm(decisions): void {
      world.events.setPhase('given.llm')
      world.model.enqueue(decisions)
    },
    memo(input): { id: string } {
      prerequisite('given.memo')
      return world.fixtures.seedMemo(input)
    },
    memoryRecord(input): MemoryRecord {
      prerequisite('given.memoryRecord')
      const now = input.createdAt ?? world.clock.now().toISOString()
      const record: MemoryRecordInput = {
        id: input.id ?? world.ids.next('memory-record'),
        scopeId: input.scope.scopeId,
        scopeType: input.scope.scopeType,
        kind: input.kind,
        content: input.content,
        summary: input.summary ?? null,
        tags: input.tags ?? [],
        confidence: input.confidence ?? 1,
        status: input.status ?? 'provisional',
        source: input.source ?? 'background',
        evidence: input.evidence ?? {},
        threadContextId: input.threadContextId ?? null,
        createdAt: now,
        updatedAt: input.updatedAt ?? now,
        lastSeenAt: input.lastSeenAt ?? now,
        ...(input.embedding === undefined ? {} : { embedding: new Float32Array([...input.embedding]) }),
      }
      return world.fixtures.seedMemoryRecord(record)
    },
    dirtyContext(context, input): void {
      prerequisite('given.dirtyContext')
      world.fixtures.seedDirtyContext({
        contextId: scopedStorageContextId(context),
        contextType: context.kind === 'dm' ? 'dm' : 'group',
        configContextId: scopedConfigContextId(context),
        messages: input.messages,
        lastActivityAt: input.lastActivityAt,
        ...(input.lastExtractedAt === undefined ? {} : { lastExtractedAt: input.lastExtractedAt }),
      })
    },
    instruction(context, text, id): { id: string } {
      prerequisite('given.instruction')
      return world.fixtures.seedInstruction({
        contextId: scopedConfigContextId(context),
        text,
        ...(id === undefined ? {} : { id }),
      })
    },
    notifyToken(token): void {
      prerequisite('given.notifyToken')
      world.fixtures.seedNotifyToken(token)
    },
    mcpPluginServer(platformInstanceId, pluginId): void {
      prerequisite('given.mcpPluginServer')
      world.fixtures.enableMcpPluginServer(platformInstanceId, pluginId)
    },
    publicBaseUrl(url): void {
      prerequisite('given.publicBaseUrl')
      world.fixtures.setPublicBaseUrl(url)
    },
    allowPublicUrl(): void {
      prerequisite('given.allowPublicUrl')
      world.fixtures.allowPublicUrl()
    },
    exhaustedWebFetchQuota(context): void {
      prerequisite('given.exhaustedWebFetchQuota')
      world.fixtures.exhaustWebFetchQuota({
        actorId: contextId(context),
        nowMs: Date.now(),
      })
    },
    recurringTask(context, input): { id: string; userId: string } {
      prerequisite('given.recurringTask')
      const id = input.id ?? world.ids.next('recurring-task')
      const userId = toScopedContextId({
        platformInstanceId: context.platformInstanceId,
        nativeContextId: contextId(context),
      })
      world.fixtures.seedRecurringTask({
        id,
        userId,
        projectId: input.projectId ?? 'project-1',
        title: input.title,
        nextRun: input.nextRun,
        rrule: input.rrule ?? 'FREQ=DAILY',
        dtstartUtc: input.dtstartUtc ?? '2020-01-01T09:00:00.000Z',
        enabled: input.enabled ?? '1',
      })
      return { id, userId }
    },
    scheduledPrompt(context, input): { id: string } {
      prerequisite('given.scheduledPrompt')
      const id = input.id ?? world.ids.next('scheduled-prompt')
      world.fixtures.seedScheduledPrompt({
        id,
        createdByUserId: scopedStorageContextId(context),
        deliveryContextId: scopedStorageContextId(context),
        deliveryContextType: context.kind === 'dm' ? 'dm' : 'group',
        prompt: input.prompt,
        fireAt: input.fireAt,
        ...(input.executionMetadata === undefined ? {} : { executionMetadata: input.executionMetadata }),
      })
      return { id }
    },
    alertPrompt(context, input): { id: string } {
      prerequisite('given.alertPrompt')
      const id = input.id ?? world.ids.next('alert-prompt')
      world.fixtures.seedAlertPrompt({
        id,
        createdByUserId: scopedStorageContextId(context),
        deliveryContextId: scopedStorageContextId(context),
        deliveryContextType: context.kind === 'dm' ? 'dm' : 'group',
        prompt: input.prompt,
        condition: JSON.stringify(input.condition),
      })
      return { id }
    },
  }
}

function createWhen(world: ScenarioWorld): ScenarioWhen {
  return {
    async message(user, context, text): Promise<void> {
      world.events.setPhase('when.message')
      await world.ensureStarted()
      await world.runtime.dispatch(messageForContext(world, user, context, text))
      await world.settle()
    },
    async dispatchMessage(user, context, text): Promise<void> {
      world.events.setPhase('when.dispatchMessage')
      await world.ensureStarted()
      await world.runtime.dispatch(messageForContext(world, user, context, text))
    },
    async interaction(user, context, callbackData): Promise<void> {
      world.events.setPhase('when.interaction')
      await world.ensureStarted()
      await world.runtime.dispatchInteraction(interactionForContext(user, context, callbackData))
      await world.settle()
    },
    settingsSession(user): Promise<SettingsSessionHandle> {
      world.events.setPhase('when.settingsSession')
      return createSettingsSession(world, user)
    },
    request(path, init): Promise<Response> {
      world.events.setPhase('when.request')
      return runtimeRequest(world, path, init)
    },
    dashboardRequest(session, path, init): Promise<Response> {
      world.events.setPhase('when.dashboardRequest')
      const headers = world.fixtures.dashboardSessions.buildHeaders(session, init?.headers)
      return runtimeRequest(world, path, { ...init, headers })
    },
    settingsRequest(session, path, init, options): Promise<Response> {
      world.events.setPhase('when.settingsRequest')
      return runtimeRequest(world, path, init, { session, withCsrf: options?.csrf ?? true })
    },
    async captureSweep(input = {}): Promise<void> {
      world.events.setPhase('when.captureSweep')
      const now = input.now ?? FIXED_SWEEP_NOW
      const patch: MemoryPatch = {
        profile: null,
        records: (input.records ?? []).map((record) => ({
          kind: record.kind,
          content: record.content,
          summary: record.summary ?? null,
          tags: [...(record.tags ?? [])],
          confidence: record.confidence ?? 1,
          source: 'background',
          evidence: record.evidence ?? {},
        })),
        updates: [],
      }
      const captureDeps: RunMemoryCaptureDeps = {
        extractMemoryPatch: () => Promise.resolve(patch),
        // `getEmbeddingForContext` (the production default) resolves through the real AI SDK HTTP
        // client, which has no fetch-injection seam and therefore cannot be intercepted by
        // `world.http` under `--contracts` (the io-guard's global-fetch patch is only installed by
        // `tests/stories/preload.ts`, which sandboxed non-contracts runs preload). Scenarios drive
        // capture through `RunMemoryCaptureDeps.getEmbedding` directly instead — the same DI seam
        // production code exposes — mirroring how `extractMemoryPatch` is already scripted above.
        getEmbedding: input.getEmbedding ?? ((): Promise<number[] | null> => Promise.resolve([...MATCH_EMBEDDING])),
        now: () => now,
        randomUUID: () => world.ids.next('memory-record'),
      }
      const sweepDeps: SweepDeps = {
        idleMs: input.idleMs ?? DEFAULT_IDLE_MS,
        loadHistory: (storageContextId) => getCachedHistory(storageContextId),
        runCapture: (captureInput) => runMemoryCapture(captureInput, captureDeps),
      }
      await sweepDirtyContexts(now, sweepDeps)
    },
    async promotionSweep(input = {}): Promise<void> {
      world.events.setPhase('when.promotionSweep')
      const now = input.now ?? FIXED_SWEEP_NOW
      const sweepPromotionsDeps: SweepPromotionsDeps = {
        listScopes: defaultPromotionScopes,
        evaluate: (scope, candidate) =>
          evaluatePromotion(scope, candidate, {
            confirmDurable: input.confirmDurable ?? ((): Promise<boolean> => Promise.resolve(true)),
            now: () => now,
          }),
      }
      await sweepPromotions(sweepPromotionsDeps)
    },
    async recurringTick(): Promise<void> {
      world.events.setPhase('when.recurringTick')
      await world.ensureStarted()
      await tick({ resolve: () => world.fixtures.taskProvider, chat: world.chat })
    },
    async startScheduler(): Promise<void> {
      world.events.setPhase('when.startScheduler')
      await world.startScheduler()
    },
    async scheduledPoll(): Promise<void> {
      world.events.setPhase('when.scheduledPoll')
      await world.ensureStarted()
      await pollScheduledOnce(world.chat, () => world.fixtures.taskProvider)
    },
    async alertPoll(): Promise<void> {
      world.events.setPhase('when.alertPoll')
      await world.ensureStarted()
      await pollAlertsOnce(world.chat, () => world.fixtures.taskProvider)
    },
  }
}

function createThen(world: ScenarioWorld): ScenarioThen {
  return {
    replyTo: (user) => replyAssertion(world, () => repliesForContext(world, user.id)),
    repliesTo: (user) => replyHistoryAssertion(world, () => repliesForContext(world, user.id)),
    replyIn: (context) =>
      replyAssertion(world, () =>
        context.kind === 'thread' ? repliesForThread(world, context) : repliesForContext(world, contextId(context)),
      ),
    proactiveAttempts: (): ProactiveAttemptsAssertion => ({
      equal(expectedContextIds): void {
        const actualContextIds = world.chat
          .proactiveAttempts()
          .map((attempt) => attempt.contextId)
          .sort()
        tracedAssertion(world, () => expect(actualContextIds).toEqual([...expectedContextIds].sort()))
      },
    }),
    announcementDeliveries: (version): AnnouncementDeliveriesAssertion => ({
      equal(expected): void {
        tracedAssertion(world, () => {
          const actual = getDrizzleDb()
            .select({
              contextId: announcementDeliveries.contextId,
              contextType: announcementDeliveries.contextType,
              status: announcementDeliveries.status,
            })
            .from(announcementDeliveries)
            .where(eq(announcementDeliveries.version, version))
            .all()
            .map((delivery): AnnouncementDelivery => {
              const { contextId: deliveryContextId, contextType, status } = delivery
              if (contextType !== 'dm' && contextType !== 'group') {
                throw new Error(`Unexpected announcement delivery context type: ${contextType}`)
              }
              if (status !== 'sent' && status !== 'failed') {
                throw new Error(`Unexpected announcement delivery status: ${status}`)
              }
              return { contextId: deliveryContextId, contextType, status }
            })
            .sort((left, right) => left.contextId.localeCompare(right.contextId))
          const sortedExpected = [...expected].sort((left, right) => left.contextId.localeCompare(right.contextId))

          expect(actual).toEqual(sortedExpected)
        })
      },
    }),
    task: (title) => ({
      async exists(): Promise<void> {
        const matches = await world.tasks.searchTasks({ query: title })
        tracedAssertion(world, () => expect(matches.some((task) => task.title === title)).toBe(true))
      },
      async absent(): Promise<void> {
        const matches = await world.tasks.searchTasks({ query: title })
        tracedAssertion(world, () => expect(matches.some((task) => task.title === title)).toBe(false))
      },
    }),
    codingSessions: (context) => codingSessionsAssertion(world, context),
    responseStatus(response, expected): void {
      tracedAssertion(world, () => expect(response.status).toBe(expected))
    },
    responseJson(body): ResponseJsonAssertion {
      return {
        contains: (needle) => tracedAssertion(world, () => expect(JSON.stringify(body)).toContain(needle)),
        equals: (expected) => tracedAssertion(world, () => expect(body).toEqual(expected)),
      }
    },
  }
}

export function createScenarioApi(world: ScenarioWorld): ScenarioApi {
  return {
    world,
    given: createGiven(world),
    when: createWhen(world),
    then: createThen(world),
    async resolveRealTaskProvider(context: ContextHandle): Promise<TaskProvider> {
      const provider = await defaultTaskProviderResolver.resolve(scopedConfigContextId(context))
      if (provider === null) throw new Error('Scenario expected a resolvable real task provider')
      return provider
    },
  }
}

function combineFailures(primary: unknown, teardown: unknown): AggregateError {
  const teardownErrors: unknown[] =
    teardown instanceof AggregateError ? teardown.errors.map((error: unknown): unknown => error) : [teardown]
  return new AggregateError([primary, ...teardownErrors], 'Scenario execution and teardown failed', { cause: primary })
}

export function executeScenario(
  name: string,
  run: (api: ScenarioApi) => void | Promise<void>,
  createWorld?: WorldFactory,
  options?: ScenarioOptions,
): Promise<void> {
  return runWithScenarioIoGuard(name, async (guard): Promise<void> => {
    const factory =
      createWorld ??
      ((scenarioName): Promise<ScenarioWorld> =>
        import('./world.js').then((module) =>
          module.createScenarioWorld(scenarioName, {
            tempRoot: guard?.tempRoot,
            debugEnabled: options?.debugEnabled,
            realTaskProvider: options?.realTaskProvider,
          }),
        ))
    const world = await factory(name)
    guard?.bind({ events: world.events, http: world.http })
    let primaryFailure: Error | undefined
    try {
      await run(world.api)
      world.verify()
    } catch (error) {
      primaryFailure = error instanceof Error ? error : new Error(String(error))
    }
    let teardownFailure: Error | undefined
    try {
      await world.stop()
    } catch (error) {
      teardownFailure = error instanceof Error ? error : new Error(String(error))
    }
    try {
      guard?.verify()
    } catch (error) {
      const guardFailure = error instanceof Error ? error : new Error(String(error))
      teardownFailure = teardownFailure === undefined ? guardFailure : combineFailures(teardownFailure, guardFailure)
    }
    if (teardownFailure !== undefined) {
      if (primaryFailure !== undefined) throw combineFailures(primaryFailure, teardownFailure)
      return Promise.reject(teardownFailure)
    }
    if (primaryFailure !== undefined) return Promise.reject(primaryFailure)
  })
}

export function scenario(
  name: string,
  run: (api: ScenarioApi) => void | Promise<void>,
  options?: ScenarioOptions,
): void {
  test(name, () => executeScenario(name, run, undefined, options))
}
