// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import type { DiscoveredPlugin } from '../../../src/plugins/types.js'
import { SCENARIO_PLATFORM_INSTANCE_ID } from './fixtures.js'
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
} from './world.js'

type ScenarioGiven = Readonly<{
  user(id: string): UserHandle
  group(id: string): GroupHandle
  member(group: GroupHandle, user: UserHandle): void
  dm(user: UserHandle): DmHandle
  thread(group: GroupHandle, id: string): ThreadHandle
  taskInstance(id?: string, providerType?: string): TaskInstanceHandle
  assign(context: ContextHandle, taskInstance: TaskInstanceHandle): void
  plugin(plugin: DiscoveredPlugin): PluginHandle
  llm(decisions: readonly ModelDecision[]): void
}>

type ScenarioWhen = Readonly<{
  message(user: UserHandle, context: ContextHandle, text: string): Promise<void>
  interaction(user: UserHandle, context: ContextHandle, callbackData: string): Promise<void>
  request(path: string, init?: RequestInit): Promise<Response>
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

function tracedAssertion(world: ScenarioWorld, assertion: () => void): void {
  try {
    assertion()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(world.events.formatFailure(message), { cause: error })
  }
}

function replyAssertion(world: ScenarioWorld, id: string): ReplyAssertion {
  return {
    equals(expected): void {
      const replies = repliesForContext(world, id).filter(({ content }) => content !== undefined)
      tracedAssertion(world, () => expect(replies.at(-1)?.content).toBe(expected))
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
    group(id): GroupHandle {
      prerequisite('given.group')
      world.fixtures.authorizeGroup({ groupId: id })
      return makeGroupHandle(id)
    },
    member(group, user): void {
      prerequisite('given.member')
      world.fixtures.addGroupMember({ groupId: group.id, userId: user.id })
    },
    dm: makeDmHandle,
    thread: makeThreadHandle,
    taskInstance(id = world.ids.next('task-instance'), providerType = 'kaneo'): TaskInstanceHandle {
      prerequisite('given.taskInstance')
      world.fixtures.seedTaskInstance({ id, type: providerType })
      return makeTaskInstanceHandle(id, providerType)
    },
    assign(context, taskInstance): void {
      prerequisite('given.assign')
      world.fixtures.assignContext({
        contextId: contextId(context),
        platformInstanceId: SCENARIO_PLATFORM_INSTANCE_ID,
        taskInstanceId: taskInstance.id,
      })
    },
    plugin(plugin): PluginHandle {
      prerequisite('given.plugin')
      const approved = world.fixtures.approvePlugin(plugin)
      return makePluginHandle(approved)
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
    async request(path, init): Promise<Response> {
      world.events.setPhase('when.request')
      await world.ensureStarted()
      return world.runtime.request(new Request(new URL(path, 'http://scenario.invalid'), init))
    },
  }
}

function createThen(world: ScenarioWorld): ScenarioThen {
  return {
    replyTo: (user) => replyAssertion(world, user.id),
    replyIn: (context) => replyAssertion(world, contextId(context)),
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
  return new AggregateError([primary, teardown], 'Scenario execution and teardown failed', { cause: primary })
}

export async function executeScenario(
  name: string,
  run: (api: ScenarioApi) => Promise<void>,
  createWorld?: WorldFactory,
): Promise<void> {
  const factory =
    createWorld ??
    ((scenarioName): Promise<ScenarioWorld> =>
      import('./world.js').then((module) => module.createScenarioWorld(scenarioName)))
  const world = await factory(name)
  let primaryFailure: Error | undefined
  try {
    await run(world.api)
    world.verify()
  } catch (error) {
    primaryFailure = error instanceof Error ? error : new Error(String(error))
  }
  try {
    await world.stop()
  } catch (teardownFailure) {
    if (primaryFailure !== undefined) throw combineFailures(primaryFailure, teardownFailure)
    throw teardownFailure
  }
  if (primaryFailure !== undefined) return Promise.reject(primaryFailure)
}

export function scenario(name: string, run: (api: ScenarioApi) => Promise<void>): void {
  test(name, () => executeScenario(name, run))
}
