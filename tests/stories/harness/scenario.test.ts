// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { getActivatedPluginIds } from '../../../src/plugins/loader.js'
import { SESSION_TTL_MS } from '../../../src/settings/session-store.js'
import { executeScenario } from './scenario.js'
import { answer, callCapability } from './scripted-llm.js'
import type { ScenarioWorld } from './world.js'
import { createScenarioWorld } from './world.js'

const requireAggregateError = (value: unknown): AggregateError => {
  if (value instanceof AggregateError) return value
  throw new Error('Expected aggregate scenario failure')
}

describe('scenario execution', () => {
  test('task capability prerequisite configures the provider before a core task story starts', async () => {
    await executeScenario('task capability prerequisite', async ({ given, when, then, world }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)
      const taskInstance = given.taskInstance()
      given.taskCapabilities(['tasks.delete'])
      given.assign(dm, taskInstance)
      given.llm([
        callCapability('tasks.create', { projectId: 'project-1', title: 'Release 7' }),
        answer('Created “Release 7”.'),
      ])

      await when.message(alice, dm, 'Create task Release 7')

      expect([...world.tasks.capabilities]).toEqual(['tasks.delete'])
      then.replyTo(alice).equals('Created “Release 7”.')
      await then.task('Release 7').exists()
    })
  })

  test('task capability prerequisite is blocked after startup', async () => {
    const world = await createScenarioWorld('task capability startup guard')

    try {
      await world.ensureStarted()

      expect(() => world.api.given.taskCapabilities(['tasks.delete'])).toThrow(
        'given.taskCapabilities requires an unstarted scenario world',
      )
    } finally {
      await world.stop()
    }
  })

  test('coding-session prerequisite configures the semantic capability before lazy startup', async () => {
    const world = await createScenarioWorld('coding-session prerequisite')

    try {
      const alice = world.api.given.user('alice')
      const dm = world.api.given.dm(alice)
      const configured = world.api.given.codingSession({
        pluginDirectory: 'plugins',
        context: dm,
        magiBaseUrl: 'https://magi.invalid',
        magiToken: 'scenario-token',
        updatedBy: alice.id,
      })

      expect(configured.kind).toBe('coding-session')
      expect(configured.capabilityId).toBe('coding-session.start')
      expect(configured.contextId).toBe(
        toScopedContextId({ platformInstanceId: 'scenario-platform', nativeContextId: 'alice' }),
      )
      expect(world.events.all().some(({ kind }) => kind === 'runtime.start.begin')).toBe(false)
    } finally {
      await world.stop()
    }
  })

  test('settings requests reject unsafe URLs before dispatching and accept a settings query', async () => {
    await executeScenario('settings URL safety', async ({ given, when, world }) => {
      const alice = given.user('alice')
      const session = await given.settingsSession(alice)
      const requestsBeforeRejections = world.events.all().filter(({ kind }) => kind === 'settings.request').length

      for (const unsafe of [
        'https://evil.invalid/settings/api/session',
        '//evil.invalid/settings/api/session',
        '/settings-evil',
        String.raw`\settings\api\session`,
        '/settings/%2f%2fevil.invalid/api/session',
        '/settings/%2e%2e/settings-evil',
      ]) {
        await expect(when.settingsRequest(session, unsafe)).rejects.toThrow('Unsafe settings request path')
      }
      expect(world.events.all().filter(({ kind }) => kind === 'settings.request')).toHaveLength(
        requestsBeforeRejections,
      )

      const response = await when.settingsRequest(session, '/settings/api/context/task-instance?source=scenario')
      expect(response.status).toBe(200)
    })
  })

  test('settings session handles are bound to one active world and cannot be fabricated', async () => {
    const first = await createScenarioWorld('first session world')
    const alice = first.api.given.user('alice')
    const session = await first.api.given.settingsSession(alice)
    const second = await createScenarioWorld('second session world')

    try {
      await expect(second.api.when.settingsRequest(session, '/settings/api/session')).rejects.toThrow(
        'Settings session handle belongs to a different scenario world',
      )
      const fabricated = structuredClone(session)
      await expect(second.api.when.settingsRequest(fabricated, '/settings/api/session')).rejects.toThrow(
        'Unknown settings session handle',
      )
      expect(second.events.all().some(({ kind }) => kind === 'settings.request')).toBe(false)
    } finally {
      await second.stop()
      await first.stop()
    }

    await expect(first.api.when.settingsRequest(session, '/settings/api/session')).rejects.toThrow(
      'Scenario settings sessions are no longer active',
    )
  })

  test('the world clock deterministically expires an exchanged settings session', async () => {
    await executeScenario('settings session expiry', async ({ given, when, world }) => {
      const alice = given.user('alice')
      const session = await given.settingsSession(alice)
      expect((await when.settingsRequest(session, '/settings/api/session')).status).toBe(200)

      world.clock.advance(SESSION_TTL_MS)

      expect((await when.settingsRequest(session, '/settings/api/context/task-instance')).status).toBe(401)
    })
  })

  test('preserves a primary assertion failure while surfacing every teardown failure and attempt', async () => {
    let capturedWorld: ScenarioWorld | undefined
    const createWorld = async (name: string): Promise<ScenarioWorld> => {
      const world = await createScenarioWorld(name)
      capturedWorld = world
      return world
    }

    const failure = await executeScenario(
      'failure cleanup',
      ({ world }): Promise<void> => {
        world.http.expect({ method: 'GET', url: 'https://unused.invalid/' }, () => new Response('unused'))
        expect('actual').toBe('expected')
        return Promise.resolve()
      },
      createWorld,
    ).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(AggregateError)
    const aggregate = requireAggregateError(failure)
    expect(String(aggregate.errors[0])).toContain('expected')
    expect(String(aggregate.errors[1])).toContain('unconsumed HTTP expectations')
    expect(capturedWorld).toBeDefined()
    const cleanupKinds = capturedWorld?.events
      .all()
      .filter(({ kind }) => kind.startsWith('world.cleanup.'))
      .map(({ kind }) => kind)
    expect(cleanupKinds).toEqual([
      'world.cleanup.runtime.stop',
      'world.cleanup.plugins.deactivate',
      'world.cleanup.provider.unregister',
      'world.cleanup.database.reset',
      'world.cleanup.http.verify',
      'world.cleanup.model.verify',
    ])
    expect(capturedWorld?.events.all().some(({ kind }) => kind === 'chat.start')).toBe(false)
    expect(getActivatedPluginIds()).toEqual([])
  })

  test('decorates DSL assertion failures with the sanitized event trace', async () => {
    const world = await createScenarioWorld('trace')

    try {
      const alice = world.api.given.user('alice')
      expect(() => world.api.then.replyTo(alice).equals('missing')).toThrow('recent events:')
    } finally {
      await world.stop()
    }
  })

  test('flattens primary, HTTP, and model teardown failures in order', async () => {
    const primary = new Error('primary assertion')
    const failure = await executeScenario('flatten teardown', ({ world }): Promise<void> => {
      world.http.expect({ method: 'GET', url: 'https://unused.invalid/' }, () => new Response('unused'))
      world.api.given.llm([{ kind: 'answer', text: 'unused model answer' }])
      return Promise.reject(primary)
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    const aggregate = requireAggregateError(failure)
    expect(aggregate.errors).toHaveLength(3)
    expect(aggregate.errors[0]).toBe(primary)
    expect(String(aggregate.errors[1])).toContain('unconsumed HTTP expectations')
    expect(String(aggregate.errors[2])).toContain('unused decision')
  })
})
