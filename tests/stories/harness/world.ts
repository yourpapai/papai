// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { getThreadScopedStorageContextId } from '../../../src/auth.js'
import { setupBot, type BotDeps } from '../../../src/bot.js'
import { ChatRouter } from '../../../src/chat/router.js'
import type { IncomingInteraction, IncomingMessage } from '../../../src/chat/types.js'
import { closeDrizzleDb } from '../../../src/db/drizzle.js'
import { routeRequest } from '../../../src/debug/server.js'
import type { ProcessMessageFn } from '../../../src/llm-orchestrator-process-args.js'
import { defaultDeps as defaultLlmDeps, processMessage } from '../../../src/llm-orchestrator.js'
import { deactivateAllPlugins } from '../../../src/plugins/loader.js'
import type { DiscoveredPlugin } from '../../../src/plugins/types.js'
import { toolCapabilityCatalog } from '../../../src/runtime/capability-catalog.js'
import { createPapaiRuntime } from '../../../src/runtime/create-runtime.js'
import { createProductionRuntimeDeps } from '../../../src/runtime/production-deps.js'
import type { PapaiRuntime, PapaiRuntimeDeps } from '../../../src/runtime/types.js'
import { createScenarioChat, type ScenarioChat, type ScenarioReply } from './chat.js'
import { createScenarioEvents, type ScenarioEvent, type ScenarioEvents } from './events.js'
import { SCENARIO_PLATFORM_INSTANCE_ID, createScenarioFixtures, type ScenarioFixtures } from './fixtures.js'
import { MemoryTaskProvider } from './memory-task-provider.js'
import {
  createScenarioRuntimeExtensionLifecycle,
  type ScenarioRuntimeExtensionLifecycle,
  type ScenarioRuntimeExtension,
} from './runtime-extension.js'
import { createScenarioApi, type ScenarioApi } from './scenario.js'
import { createScriptedModel, type ScriptedModel } from './scripted-llm.js'
import { createStrictHttpDispatcher, type StrictHttpDispatcher } from './strict-http.js'

const FIXED_NOW = '2026-01-01T00:00:00.000Z'
const ADMIN_USER_ID = 'scenario-admin'

export type ScenarioClock = Readonly<{ now(): Date; advance(milliseconds: number): void }>
export type ScenarioIds = Readonly<{ next(namespace: string): string }>

const userHandleBrand: unique symbol = Symbol('scenario-user')
const groupHandleBrand: unique symbol = Symbol('scenario-group')
const threadHandleBrand: unique symbol = Symbol('scenario-thread')
const dmHandleBrand: unique symbol = Symbol('scenario-dm')
const taskInstanceHandleBrand: unique symbol = Symbol('scenario-task-instance')
const pluginHandleBrand: unique symbol = Symbol('scenario-plugin')

export type UserHandle = Readonly<{
  kind: 'user'
  id: string
  username: string
  platformInstanceId: string
  readonly [userHandleBrand]: true
}>
export type GroupHandle = Readonly<{
  kind: 'group'
  id: string
  platformInstanceId: string
  readonly [groupHandleBrand]: true
}>
export type ThreadHandle = Readonly<{
  kind: 'thread'
  id: string
  group: GroupHandle
  platformInstanceId: string
  readonly [threadHandleBrand]: true
}>
export type DmHandle = Readonly<{
  kind: 'dm'
  id: string
  user: UserHandle
  platformInstanceId: string
  readonly [dmHandleBrand]: true
}>
export type ContextHandle = DmHandle | GroupHandle | ThreadHandle
export type TaskInstanceHandle = Readonly<{
  kind: 'task-instance'
  id: string
  providerType: string
  readonly [taskInstanceHandleBrand]: true
}>
export type PluginHandle = Readonly<{
  kind: 'plugin'
  id: string
  plugin: DiscoveredPlugin
  readonly [pluginHandleBrand]: true
}>

export type ScenarioWorldTestHooks = Readonly<{
  afterDatabaseSetup?(): void | Promise<void>
  afterProductionExtensionsStart?(): void | Promise<void>
  onCleanupStep?(kind: string): void
}>

export type ScenarioWorldOptions = Readonly<{
  runtimeExtensions?: readonly ScenarioRuntimeExtension[]
  testHooks?: ScenarioWorldTestHooks
  tempRoot?: string
}>

export type ScenarioWorld = Readonly<{
  name: string
  api: ScenarioApi
  runtime: PapaiRuntime
  events: ScenarioEvents
  chat: ScenarioChat
  http: StrictHttpDispatcher
  model: ScriptedModel
  tasks: MemoryTaskProvider
  fixtures: ScenarioFixtures
  clock: ScenarioClock
  ids: ScenarioIds
  tempRoot: string
  startupEvents: readonly ScenarioEvent[]
  capabilityEntriesAtStart: ReadonlyArray<readonly [string, string]>
  start(): Promise<void>
  ensureStarted(): Promise<void>
  assertPrerequisitesOpen(operation: string): void
  registerRuntimeExtension(extension: ScenarioRuntimeExtension): void
  message(user: UserHandle, context: ContextHandle, text: string): IncomingMessage
  repliesForThread(thread: ThreadHandle): readonly ScenarioReply[]
  settle(): Promise<void>
  verify(): void
  stop(): Promise<void>
}>

export const makeUserHandle = (id: string): UserHandle => ({
  kind: 'user',
  id,
  username: id,
  platformInstanceId: SCENARIO_PLATFORM_INSTANCE_ID,
  [userHandleBrand]: true,
})
export const makeGroupHandle = (id: string): GroupHandle => ({
  kind: 'group',
  id,
  platformInstanceId: SCENARIO_PLATFORM_INSTANCE_ID,
  [groupHandleBrand]: true,
})
export const makeThreadHandle = (group: GroupHandle, id: string): ThreadHandle => ({
  kind: 'thread',
  id,
  group,
  platformInstanceId: group.platformInstanceId,
  [threadHandleBrand]: true,
})
export const makeDmHandle = (user: UserHandle): DmHandle => ({
  kind: 'dm',
  id: user.id,
  user,
  platformInstanceId: user.platformInstanceId,
  [dmHandleBrand]: true,
})
export const makeTaskInstanceHandle = (id: string, providerType: string): TaskInstanceHandle => ({
  kind: 'task-instance',
  id,
  providerType,
  [taskInstanceHandleBrand]: true,
})
export const makePluginHandle = (plugin: DiscoveredPlugin): PluginHandle => ({
  kind: 'plugin',
  id: plugin.manifest.id,
  plugin,
  [pluginHandleBrand]: true,
})

type PendingWork = Readonly<{
  enqueue: NonNullable<BotDeps['enqueueMessage']>
  settle(): Promise<void>
  hasPending(): boolean
}>

const createClock = (): ScenarioClock => {
  let nowMs = new Date(FIXED_NOW).getTime()
  return {
    now: (): Date => new Date(nowMs),
    advance(milliseconds): void {
      if (!Number.isFinite(milliseconds)) throw new Error('Scenario clock advance must be finite')
      nowMs += milliseconds
    },
  }
}

const createIds = (): ScenarioIds => {
  const sequences = new Map<string, number>()
  return {
    next(namespace): string {
      const sequence = (sequences.get(namespace) ?? 0) + 1
      sequences.set(namespace, sequence)
      return `${namespace}-${sequence}`
    },
  }
}

function createPendingWork(ids: ScenarioIds): PendingWork {
  const pending = new Set<Promise<void>>()
  let failures: readonly unknown[] = []
  const enqueue: NonNullable<BotDeps['enqueueMessage']> = (item, reply, handler): void => {
    const running = handler({
      ...item,
      reply,
      turnId: ids.next('turn'),
    }).catch((error: unknown) => {
      failures = [...failures, error]
    })
    pending.add(running)
    void running.finally((): void => {
      pending.delete(running)
    })
  }
  return {
    enqueue,
    async settle(): Promise<void> {
      while (pending.size > 0) await Promise.all([...pending])
      if (failures.length === 0) return
      const captured = failures
      failures = []
      if (captured.length === 1) throw captured[0]
      throw new AggregateError(captured, 'Multiple scenario message operations failed')
    },
    hasPending: () => pending.size > 0,
  }
}

function createScenarioProcessMessage(model: ScriptedModel): ProcessMessageFn {
  return (reply, contextId, userId, username, text, contextType, ...rest) => {
    const [configContextId, deps, attachmentIds, turnId, actorRole] = rest
    return processMessage(
      reply,
      contextId,
      userId,
      username,
      text,
      contextType,
      configContextId,
      {
        ...(deps ?? defaultLlmDeps),
        buildModel: () => model.model,
      },
      attachmentIds,
      turnId,
      actorRole,
    )
  }
}

function createRouter(chat: ScenarioChat): ChatRouter {
  const router = new ChatRouter((id) => {
    if (id !== SCENARIO_PLATFORM_INSTANCE_ID) throw new Error(`Unexpected scenario chat instance: ${id}`)
    return chat
  })
  router.addInstance(SCENARIO_PLATFORM_INSTANCE_ID, 'telegram', {})
  return router
}

function assertionFailures(events: ScenarioEvents, checks: ReadonlyArray<() => void>): readonly unknown[] {
  const failures: unknown[] = []
  for (const check of checks) {
    try {
      check()
    } catch (error) {
      failures.push(error)
    }
  }
  return failures.map((error) => (error instanceof Error ? error : new Error(events.formatFailure(String(error)))))
}

function throwFailures(failures: readonly unknown[], message: string, events: ScenarioEvents): void {
  if (failures.length === 0) return
  const decorated = events.formatFailure(message)
  if (failures.length === 1) {
    const failure = failures[0]
    const detail = failure instanceof Error ? failure.message : String(failure)
    throw failure instanceof Error
      ? new Error(`${decorated}\ncaused by: ${detail}`, { cause: failure })
      : new Error(`${decorated}\ncaused by: ${detail}`)
  }
  throw new AggregateError(failures, decorated, { cause: failures[0] })
}

async function runCleanupStep(
  events: ScenarioEvents,
  kind: string,
  action: () => void | Promise<void>,
  failures: unknown[],
  hooks: ScenarioWorldTestHooks,
): Promise<void> {
  events.record(kind, {})
  try {
    hooks.onCleanupStep?.(kind)
  } catch (error) {
    failures.push(error)
  }
  try {
    await action()
  } catch (error) {
    failures.push(error)
  }
}

function setupScenarioBot(router: ChatRouter, model: ScriptedModel, pending: PendingWork): void {
  setupBot(router, ADMIN_USER_ID, {
    processMessage: createScenarioProcessMessage(model),
    enqueueMessage: pending.enqueue,
  })
}

type CleanupResources = {
  runtime: PapaiRuntime | undefined
  databaseAttempted: boolean
  providerAttempted: boolean
}

type CleanupCoordinator = Readonly<{ run(): Promise<void> }>

function createCleanupCoordinator(
  resources: CleanupResources,
  fixtures: ScenarioFixtures,
  events: ScenarioEvents,
  http: StrictHttpDispatcher,
  model: ScriptedModel,
  hooks: ScenarioWorldTestHooks,
  runtimeExtensions: ScenarioRuntimeExtensionLifecycle | undefined,
): CleanupCoordinator {
  let cleanupInFlight: Promise<void> | undefined
  const run = (): Promise<void> => {
    if (cleanupInFlight !== undefined) return cleanupInFlight
    cleanupInFlight = (async (): Promise<void> => {
      const failures: unknown[] = []
      if (resources.runtime !== undefined)
        await runCleanupStep(events, 'world.cleanup.runtime.stop', () => resources.runtime?.stop(), failures, hooks)
      if (runtimeExtensions?.hasRegistered() === true)
        await runCleanupStep(events, 'world.cleanup.runtime-extensions.stop', runtimeExtensions.stop, failures, hooks)
      await runCleanupStep(events, 'world.cleanup.plugins.deactivate', deactivateAllPlugins, failures, hooks)
      if (resources.providerAttempted)
        await runCleanupStep(events, 'world.cleanup.provider.unregister', fixtures.teardown, failures, hooks)
      if (resources.databaseAttempted)
        await runCleanupStep(events, 'world.cleanup.database.reset', closeDrizzleDb, failures, hooks)
      await runCleanupStep(events, 'world.cleanup.http.verify', http.verifyConsumed, failures, hooks)
      await runCleanupStep(events, 'world.cleanup.model.verify', model.verifyConsumed, failures, hooks)
      throwFailures(failures, 'Scenario teardown failed', events)
    })()
    return cleanupInFlight
  }
  return { run }
}

async function failAfterCleanup(primary: unknown, cleanup: CleanupCoordinator, events: ScenarioEvents): Promise<never> {
  const primaryError = primary instanceof Error ? primary : new Error(String(primary))
  const cleanupResult = await cleanup.run().then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  if (!cleanupResult.ok) {
    const cleanupFailure = cleanupResult.error
    const cleanupErrors: unknown[] =
      cleanupFailure instanceof AggregateError
        ? cleanupFailure.errors.map((error: unknown): unknown => error)
        : [cleanupFailure]
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      events.formatFailure('Scenario setup and cleanup failed'),
      {
        cause: cleanupFailure,
      },
    )
  }
  throw primaryError
}

function wrapProductionExtensions(
  deps: PapaiRuntimeDeps,
  hooks: ScenarioWorldTestHooks,
  runtimeExtensions: ScenarioRuntimeExtensionLifecycle,
): PapaiRuntimeDeps['extensions'] {
  return {
    ...deps.extensions,
    async start(router): Promise<readonly string[]> {
      await runtimeExtensions.start()
      const activated = await deps.extensions.start(router)
      await hooks.afterProductionExtensionsStart?.()
      return activated
    },
  }
}

export async function createScenarioWorld(name: string, options: ScenarioWorldOptions = {}): Promise<ScenarioWorld> {
  const hooks = options.testHooks ?? {}
  const events = createScenarioEvents(name)
  const clock = createClock()
  const ids = createIds()
  const http = createStrictHttpDispatcher(events)
  const chat = createScenarioChat(name, events)
  let runtime: PapaiRuntime | undefined
  const model = createScriptedModel({
    events,
    autoLoadTools: true,
    nextId: (): string => ids.next('tool-call'),
    resolveCapability: (capabilityId) => {
      if (runtime === undefined) throw new Error('Scenario runtime is not ready')
      return runtime.resolveToolCapability(capabilityId)
    },
  })
  const tasks = new MemoryTaskProvider({ events, nextId: (): string => ids.next('task') })
  const fixtures = createScenarioFixtures({ taskProvider: tasks })
  const resources: CleanupResources = { runtime: undefined, databaseAttempted: false, providerAttempted: false }
  let runtimeExtensions: readonly ScenarioRuntimeExtension[] = [...(options.runtimeExtensions ?? [])]
  const runtimeExtensionLifecycle = createScenarioRuntimeExtensionLifecycle(() => runtimeExtensions, {
    record(kind, data): void {
      events.record(kind, data)
    },
  })
  const cleanup = createCleanupCoordinator(resources, fixtures, events, http, model, hooks, runtimeExtensionLifecycle)
  const pending = createPendingWork(ids)
  const router = createRouter(chat)
  let startupEvents: readonly ScenarioEvent[] = []
  let capabilityEntriesAtStart: ReadonlyArray<readonly [string, string]> = []
  let api: ScenarioApi | undefined
  let state: 'new' | 'starting' | 'started' | 'stopping' | 'stopped' = 'new'
  let startInFlight: Promise<void> | undefined

  try {
    resources.databaseAttempted = true
    await fixtures.setupDatabase()
    await hooks.afterDatabaseSetup?.()
    fixtures.seedPlatformInstance()
    fixtures.seedSystemLlmConfig()
    resources.providerAttempted = true
    fixtures.registerTaskProvider()
    const pluginProviderRuntimeDeps = { fetch: http.fetch, assertPublicUrl: (): Promise<void> => Promise.resolve() }
    const productionDeps = createProductionRuntimeDeps(
      {
        database: { start: () => undefined, stop: () => undefined },
        chat: { createRouter: () => router, ingress: chat },
        application: {
          setupBot: (activeRouter) => setupScenarioBot(activeRouter, model, pending),
          flush: pending.settle,
        },
        web: {
          route: (request) =>
            routeRequest(request, {
              debugEnabled: false,
              nowMs: clock.now().getTime(),
              pluginProviderRuntimeDeps,
            }),
        },
      },
      { pluginProviderRuntimeDeps },
    )
    const deps = {
      ...productionDeps,
      extensions: wrapProductionExtensions(productionDeps, hooks, runtimeExtensionLifecycle),
    }
    runtime = createPapaiRuntime(
      {
        adminUserId: ADMIN_USER_ID,
        pluginDirectory: 'plugins',
        startBackgroundServices: false,
        startNetworkServer: false,
        sendStartupAnnouncement: false,
      },
      deps,
    )
    resources.runtime = runtime
  } catch (error) {
    return failAfterCleanup(error, cleanup, events)
  }

  const start = (): Promise<void> => {
    if (state === 'started') return Promise.resolve()
    if (state === 'starting' && startInFlight !== undefined) return startInFlight
    if (state !== 'new') return Promise.reject(new Error(events.formatFailure(`scenario runtime is ${state}`)))
    state = 'starting'
    const starting = runtime
      .start()
      .then((): void => {
        if (state === 'starting') state = 'started'
        startupEvents = events.all()
        capabilityEntriesAtStart = toolCapabilityCatalog.entries()
      })
      .catch(async (error: unknown): Promise<never> => {
        state = 'stopping'
        try {
          return await failAfterCleanup(error, cleanup, events)
        } finally {
          state = 'stopped'
        }
      })
    startInFlight = starting
    return starting
  }

  const stop = async (): Promise<void> => {
    if (state !== 'stopped') state = 'stopping'
    try {
      await cleanup.run()
    } finally {
      state = 'stopped'
    }
  }

  const verify = (): void => {
    const failures = assertionFailures(events, [
      (): void => model.verifyConsumed(),
      (): void => http.verifyConsumed(),
      (): void => expect(pending.hasPending()).toBe(false),
    ])
    throwFailures(failures, 'Scenario verification failed', events)
  }

  const assertPrerequisitesOpen = (operation: string): void => {
    if (state !== 'new') throw new Error(events.formatFailure(`${operation} requires an unstarted scenario world`))
  }

  const registerRuntimeExtension = (extension: ScenarioRuntimeExtension): void => {
    assertPrerequisitesOpen('registerRuntimeExtension')
    runtimeExtensions = [...runtimeExtensions, extension]
  }

  const world: ScenarioWorld = {
    name,
    runtime,
    events,
    chat,
    http,
    model,
    tasks,
    fixtures,
    clock,
    ids,
    tempRoot: options.tempRoot ?? '',
    get startupEvents(): readonly ScenarioEvent[] {
      return startupEvents
    },
    get capabilityEntriesAtStart(): ReadonlyArray<readonly [string, string]> {
      return capabilityEntriesAtStart
    },
    start,
    ensureStarted: start,
    assertPrerequisitesOpen,
    registerRuntimeExtension,
    message: (user, context, text) => messageForContext(world, user, context, text),
    repliesForThread: (thread) => repliesForThread(world, thread),
    settle: pending.settle,
    verify,
    stop,
    get api(): ScenarioApi {
      api ??= createScenarioApi(world)
      return api
    },
  }
  return world
}

export const repliesForContext = (world: ScenarioWorld, contextId: string): readonly ScenarioReply[] =>
  world.chat
    .allReplies()
    .filter((reply) => reply.contextId === contextId && (reply.threadId === undefined || reply.threadId === null))

export const repliesForThread = (world: ScenarioWorld, thread: ThreadHandle): readonly ScenarioReply[] =>
  world.chat.allReplies().filter((reply) => reply.contextId === thread.group.id && reply.threadId === thread.id)

export const messageForContext = (
  world: ScenarioWorld,
  user: UserHandle,
  context: ContextHandle,
  text: string,
): IncomingMessage => {
  const commandMatch = /^\/([^\s@/]+)(?:@[^\s]+)?(?:\s|$)/u.exec(text)?.[1]
  return {
    user: { id: user.id, username: user.username, isAdmin: false },
    contextId: context.kind === 'dm' ? context.user.id : context.kind === 'thread' ? context.group.id : context.id,
    contextType: context.kind === 'dm' ? 'dm' : 'group',
    threadId: context.kind === 'thread' ? context.id : undefined,
    isMentioned: context.kind !== 'dm',
    text,
    ...(commandMatch === undefined ? {} : { commandMatch }),
    messageId: world.ids.next('message'),
    platformInstanceId: context.platformInstanceId,
  }
}

export const interactionForContext = (
  user: UserHandle,
  context: ContextHandle,
  callbackData: string,
): IncomingInteraction => ({
  kind: 'button',
  user: { id: user.id, username: user.username, isAdmin: false },
  contextId: context.kind === 'dm' ? context.user.id : context.kind === 'thread' ? context.group.id : context.id,
  contextType: context.kind === 'dm' ? 'dm' : 'group',
  threadId: context.kind === 'thread' ? context.id : undefined,
  platformInstanceId: context.platformInstanceId,
  storageContextId: getThreadScopedStorageContextId(
    context.kind === 'dm' ? context.user.id : context.kind === 'thread' ? context.group.id : context.id,
    context.kind === 'dm' ? 'dm' : 'group',
    context.kind === 'thread' ? context.id : undefined,
    context.platformInstanceId,
  ),
  callbackData,
})
