// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { setupBot, type BotDeps } from '../../../src/bot.js'
import { ChatRouter } from '../../../src/chat/router.js'
import type { IncomingInteraction, IncomingMessage } from '../../../src/chat/types.js'
import { closeDrizzleDb } from '../../../src/db/drizzle.js'
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
import { createScenarioApi, type ScenarioApi } from './scenario.js'
import { createScriptedModel, type ScriptedModel } from './scripted-llm.js'
import { createStrictHttpDispatcher, type StrictHttpDispatcher } from './strict-http.js'

const FIXED_NOW = '2026-01-01T00:00:00.000Z'
const ADMIN_USER_ID = 'scenario-admin'

export type ScenarioClock = Readonly<{ now(): Date }>
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
export type GroupHandle = Readonly<{ kind: 'group'; id: string; readonly [groupHandleBrand]: true }>
export type ThreadHandle = Readonly<{
  kind: 'thread'
  id: string
  group: GroupHandle
  readonly [threadHandleBrand]: true
}>
export type DmHandle = Readonly<{ kind: 'dm'; id: string; user: UserHandle; readonly [dmHandleBrand]: true }>
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

export type ScenarioWorldOptions = Readonly<{ testHooks?: ScenarioWorldTestHooks }>

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
  startupEvents: readonly ScenarioEvent[]
  capabilityEntriesAtStart: ReadonlyArray<readonly [string, string]>
  start(): Promise<void>
  ensureStarted(): Promise<void>
  assertPrerequisitesOpen(operation: string): void
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
export const makeGroupHandle = (id: string): GroupHandle => ({ kind: 'group', id, [groupHandleBrand]: true })
export const makeThreadHandle = (group: GroupHandle, id: string): ThreadHandle => ({
  kind: 'thread',
  id,
  group,
  [threadHandleBrand]: true,
})
export const makeDmHandle = (user: UserHandle): DmHandle => ({
  kind: 'dm',
  id: user.id,
  user,
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

const createClock = (): ScenarioClock => ({ now: (): Date => new Date(FIXED_NOW) })

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
  hooks.onCleanupStep?.(kind)
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
): CleanupCoordinator {
  let cleanupInFlight: Promise<void> | undefined
  const run = (): Promise<void> => {
    if (cleanupInFlight !== undefined) return cleanupInFlight
    cleanupInFlight = (async (): Promise<void> => {
      const failures: unknown[] = []
      if (resources.runtime !== undefined)
        await runCleanupStep(events, 'world.cleanup.runtime.stop', () => resources.runtime?.stop(), failures, hooks)
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
): PapaiRuntimeDeps['extensions'] {
  return {
    ...deps.extensions,
    async start(router): Promise<readonly string[]> {
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
    nextId: (): string => ids.next('tool-call'),
    resolveCapability: (capabilityId) => {
      if (runtime === undefined) throw new Error('Scenario runtime is not ready')
      return runtime.resolveToolCapability(capabilityId)
    },
  })
  const tasks = new MemoryTaskProvider({ events, nextId: (): string => ids.next('task') })
  const fixtures = createScenarioFixtures({ taskProvider: tasks })
  const resources: CleanupResources = { runtime: undefined, databaseAttempted: false, providerAttempted: false }
  const cleanup = createCleanupCoordinator(resources, fixtures, events, http, model, hooks)
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
    const productionDeps = createProductionRuntimeDeps({
      database: { start: () => undefined, stop: () => undefined },
      chat: { createRouter: () => router, ingress: chat },
      application: {
        setupBot: (activeRouter) => setupScenarioBot(activeRouter, model, pending),
        flush: pending.settle,
      },
    })
    const deps = { ...productionDeps, extensions: wrapProductionExtensions(productionDeps, hooks) }
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
    get startupEvents(): readonly ScenarioEvent[] {
      return startupEvents
    },
    get capabilityEntriesAtStart(): ReadonlyArray<readonly [string, string]> {
      return capabilityEntriesAtStart
    },
    start,
    ensureStarted: start,
    assertPrerequisitesOpen(operation): void {
      if (state !== 'new') throw new Error(events.formatFailure(`${operation} requires an unstarted scenario world`))
    },
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
  world.chat.allReplies().filter((reply) => reply.contextId === contextId)

export const messageForContext = (
  world: ScenarioWorld,
  user: UserHandle,
  context: ContextHandle,
  text: string,
): IncomingMessage => ({
  user: { id: user.id, username: user.username, isAdmin: false },
  contextId: context.kind === 'dm' ? context.user.id : context.kind === 'thread' ? context.group.id : context.id,
  contextType: context.kind === 'dm' ? 'dm' : 'group',
  threadId: context.kind === 'thread' ? context.id : undefined,
  isMentioned: context.kind !== 'dm',
  text,
  messageId: world.ids.next('message'),
  platformInstanceId: user.platformInstanceId,
})

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
  platformInstanceId: user.platformInstanceId,
  storageContextId: context.kind === 'thread' ? `${context.group.id}:${context.id}` : context.id,
  callbackData,
})
