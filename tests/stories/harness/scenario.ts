// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { configureCodingSessionCapability } from '../../../src/coding-sessions/configure.js'
import type { DiscoveredPlugin } from '../../../src/plugins/types.js'
import type { TaskCapability } from '../../../src/providers/types.js'
import { SCENARIO_PLATFORM_INSTANCE_ID, type SettingsSessionHandle } from './fixtures.js'
import { runWithScenarioIoGuard } from './io-guard.js'
import type { ModelDecision } from './scripted-llm.js'
import {
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

export type CodingSessionHandle = Readonly<{
  kind: 'coding-session'
  capabilityId: 'coding-session.start'
  contextId: string
  readonly [codingSessionHandleBrand]: true
}>

type ScenarioGiven = Readonly<{
  user(id: string): UserHandle
  guest(id: string): UserHandle
  group(id: string): GroupHandle
  guestMode(group: GroupHandle, enabled: true): void
  member(group: GroupHandle, user: UserHandle): void
  identity(
    user: UserHandle,
    identity: Readonly<{ providerUserId: string; login: string; displayName: string }>,
    providerName?: string,
  ): void
  providerUser(identity: Readonly<{ id: string; login: string; name?: string }>): void
  dm(user: UserHandle): DmHandle
  thread(group: GroupHandle, id: string): ThreadHandle
  taskInstance(id?: string, providerType?: string): TaskInstanceHandle
  taskCapabilities(capabilities: readonly TaskCapability[]): void
  assign(context: ContextHandle, taskInstance: TaskInstanceHandle): void
  settingsSession(user: UserHandle): Promise<SettingsSessionHandle>
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
  llm(decisions: readonly ModelDecision[]): void
}>

type ScenarioWhen = Readonly<{
  message(user: UserHandle, context: ContextHandle, text: string): Promise<void>
  interaction(user: UserHandle, context: ContextHandle, callbackData: string): Promise<void>
  request(path: string, init?: RequestInit): Promise<Response>
  settingsRequest(
    session: SettingsSessionHandle,
    path: string,
    init?: RequestInit,
    options?: Readonly<{ csrf?: boolean }>,
  ): Promise<Response>
}>

type ReplyAssertion = Readonly<{ equals(expected: string): void }>
type TaskAssertion = Readonly<{ exists(): Promise<void> }>

type ScenarioThen = Readonly<{
  replyTo(user: UserHandle): ReplyAssertion
  replyIn(context: ContextHandle): ReplyAssertion
  task(title: string): TaskAssertion
  responseStatus(response: Response, expected: number): void
}>

export type ScenarioApi = Readonly<{
  given: ScenarioGiven
  when: ScenarioWhen
  then: ScenarioThen
  world: ScenarioWorld
}>

type WorldFactory = (name: string) => Promise<ScenarioWorld>

const contextId = (context: ContextHandle): string =>
  context.kind === 'dm' ? context.user.id : context.kind === 'thread' ? context.group.id : context.id

const scopedConfigContextId = (context: ContextHandle): string =>
  toScopedContextId({ platformInstanceId: context.platformInstanceId, nativeContextId: contextId(context) })

const scopedGroupId = (group: GroupHandle): string =>
  toScopedContextId({ platformInstanceId: group.platformInstanceId, nativeContextId: group.id })

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
  }
}

function createGiven(world: ScenarioWorld): ScenarioGiven {
  const prerequisite = (operation: string): void => {
    world.events.setPhase(operation)
    world.assertPrerequisitesOpen(operation)
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
    taskInstance(id = world.ids.next('task-instance'), providerType = 'kaneo'): TaskInstanceHandle {
      prerequisite('given.taskInstance')
      world.fixtures.seedTaskInstance({ id, type: providerType })
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
    },
    async settingsSession(user): Promise<SettingsSessionHandle> {
      prerequisite('given.settingsSession')
      const principal = { platformInstanceId: user.platformInstanceId, platformUserId: user.id }
      const code = world.fixtures.issueSettingsAuthCode(principal, world.clock.now().getTime())
      const response = await runtimeRequest(world, '/settings/auth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      return world.fixtures.settingsSessions.parseExchange(principal, response)
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
    llm(decisions): void {
      world.events.setPhase('given.llm')
      world.model.enqueue(decisions)
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
    async interaction(user, context, callbackData): Promise<void> {
      world.events.setPhase('when.interaction')
      await world.ensureStarted()
      await world.runtime.dispatchInteraction(interactionForContext(user, context, callbackData))
      await world.settle()
    },
    request(path, init): Promise<Response> {
      world.events.setPhase('when.request')
      return runtimeRequest(world, path, init)
    },
    settingsRequest(session, path, init, options): Promise<Response> {
      world.events.setPhase('when.settingsRequest')
      return runtimeRequest(world, path, init, { session, withCsrf: options?.csrf ?? true })
    },
  }
}

function createThen(world: ScenarioWorld): ScenarioThen {
  return {
    replyTo: (user) => replyAssertion(world, () => repliesForContext(world, user.id)),
    replyIn: (context) =>
      replyAssertion(world, () =>
        context.kind === 'thread' ? repliesForThread(world, context) : repliesForContext(world, contextId(context)),
      ),
    task: (title) => ({
      async exists(): Promise<void> {
        const matches = await world.tasks.searchTasks({ query: title })
        tracedAssertion(world, () => expect(matches.some((task) => task.title === title)).toBe(true))
      },
    }),
    responseStatus(response, expected): void {
      tracedAssertion(world, () => expect(response.status).toBe(expected))
    },
  }
}

export function createScenarioApi(world: ScenarioWorld): ScenarioApi {
  return { world, given: createGiven(world), when: createWhen(world), then: createThen(world) }
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
): Promise<void> {
  return runWithScenarioIoGuard(name, async (guard): Promise<void> => {
    const factory =
      createWorld ??
      ((scenarioName): Promise<ScenarioWorld> =>
        import('./world.js').then((module) => module.createScenarioWorld(scenarioName, { tempRoot: guard?.tempRoot })))
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

export function scenario(name: string, run: (api: ScenarioApi) => void | Promise<void>): void {
  test(name, () => executeScenario(name, run))
}
