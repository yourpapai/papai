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
import type { PapaiRuntime } from '../../../src/runtime/types.js'
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

export type UserHandle = Readonly<{
  kind: 'user'
  id: string
  username: string
  platformInstanceId: string
}>
export type GroupHandle = Readonly<{ kind: 'group'; id: string }>
export type ThreadHandle = Readonly<{ kind: 'thread'; id: string; group: GroupHandle }>
export type DmHandle = Readonly<{ kind: 'dm'; id: string; user: UserHandle }>
export type ContextHandle = DmHandle | GroupHandle | ThreadHandle
export type TaskInstanceHandle = Readonly<{ kind: 'task-instance'; id: string; providerType: string }>
export type PluginHandle = Readonly<{ kind: 'plugin'; id: string; plugin: DiscoveredPlugin }>

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
  settle(): Promise<void>
  verify(): void
  stop(): Promise<void>
}>

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
): Promise<void> {
  events.record(kind, {})
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

export async function createScenarioWorld(name: string): Promise<ScenarioWorld> {
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
  await fixtures.setupDatabase()
  fixtures.seedPlatformInstance()
  fixtures.seedSystemLlmConfig()
  fixtures.registerTaskProvider()
  const pending = createPendingWork(ids)
  const router = createRouter(chat)
  const deps = createProductionRuntimeDeps({
    database: { start: () => undefined, stop: () => undefined },
    chat: { createRouter: () => router, ingress: chat },
    application: {
      setupBot: (activeRouter) => setupScenarioBot(activeRouter, model, pending),
      flush: pending.settle,
    },
  })
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

  await runtime.start()
  const startupEvents = events.all()
  const capabilityEntriesAtStart = toolCapabilityCatalog.entries()
  let stopInFlight: Promise<void> | undefined
  let api: ScenarioApi | undefined

  const verify = (): void => {
    const failures = assertionFailures(events, [
      (): void => model.verifyConsumed(),
      (): void => http.verifyConsumed(),
      (): void => expect(pending.hasPending()).toBe(false),
    ])
    throwFailures(failures, 'Scenario verification failed', events)
  }
  const stop = (): Promise<void> => {
    if (stopInFlight !== undefined) return stopInFlight
    stopInFlight = (async (): Promise<void> => {
      const failures: unknown[] = []
      await runCleanupStep(events, 'world.cleanup.runtime.stop', () => runtime?.stop(), failures)
      await runCleanupStep(events, 'world.cleanup.plugins.deactivate', deactivateAllPlugins, failures)
      await runCleanupStep(events, 'world.cleanup.provider.unregister', fixtures.teardown, failures)
      await runCleanupStep(events, 'world.cleanup.database.reset', closeDrizzleDb, failures)
      await runCleanupStep(events, 'world.cleanup.http.verify', () => http.verifyConsumed(), failures)
      await runCleanupStep(events, 'world.cleanup.model.verify', () => model.verifyConsumed(), failures)
      throwFailures(failures, 'Scenario teardown failed', events)
    })()
    return stopInFlight
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
    startupEvents,
    capabilityEntriesAtStart,
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
