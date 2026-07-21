// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { resolveMcpServers } from '../../../src/coding-credentials/resolve-mcp-servers.js'
import { getRepoByName } from '../../../src/coding-repos/store.js'
import { getUserMessage, webFetchError } from '../../../src/errors.js'
import { isAdmin, isSuperAdmin } from '../../../src/instances/admin-store.js'
import { getNotifyToken } from '../../../src/notify-token.js'
import { getActivatedPluginIds } from '../../../src/plugins/loader.js'
import type { TaskCapability } from '../../../src/providers/types.js'
import { SESSION_TTL_MS } from '../../../src/settings/session-store.js'
import { safeFetchContent } from '../../../src/web/safe-fetch.js'
import { expectAppError, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'
import type { ScenarioRuntimeExtension } from './runtime-extension.js'
import { executeScenario } from './scenario.js'
import { answer, callCapability } from './scripted-llm.js'
import type { ScenarioWorld } from './world.js'
import { createScenarioWorld } from './world.js'

const requireAggregateError = (value: unknown): AggregateError => {
  if (value instanceof AggregateError) return value
  throw new Error('Expected aggregate scenario failure')
}

describe('scenario execution', () => {
  test('runtime extension prerequisite starts once for a message and cleans up when the world stops', async () => {
    const lifecycle: string[] = []
    const extension: ScenarioRuntimeExtension = {
      start: (): (() => void) => {
        lifecycle.push('start')
        return (): void => {
          lifecycle.push('cleanup')
        }
      },
    }
    const world = await createScenarioWorld('runtime extension prerequisite')

    try {
      const alice = world.api.given.user('alice')
      const dm = world.api.given.dm(alice)

      world.api.given.runtimeExtension(extension)
      await world.api.when.message(alice, dm, 'hello')

      expect(lifecycle).toEqual(['start'])
    } finally {
      await world.stop()
    }

    expect(lifecycle).toEqual(['start', 'cleanup'])
  })

  test('runtime extension prerequisite is blocked after a message starts the world', async () => {
    const world = await createScenarioWorld('late runtime extension prerequisite')

    try {
      const alice = world.api.given.user('alice')
      const dm = world.api.given.dm(alice)

      await world.api.when.message(alice, dm, 'hello')

      expect(() =>
        world.api.given.runtimeExtension({
          start: (): void => undefined,
        }),
      ).toThrow('given.runtimeExtension requires an unstarted scenario world')
    } finally {
      await world.stop()
    }
  })

  test('task capability prerequisite configures the provider before a core task story starts', async () => {
    await executeScenario('task capability prerequisite', async ({ given, when, then, world }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)
      const taskInstance = given.taskInstance()
      given.taskCapabilities([])
      given.assign(dm, taskInstance)
      given.llm([
        callCapability('tasks.create', { projectId: 'project-1', title: 'Release 7' }),
        answer('Created “Release 7”.'),
      ])

      await when.message(alice, dm, 'Create task Release 7')

      expect([...world.tasks.capabilities]).toEqual([])
      then.replyTo(alice).equals('Created “Release 7”.')
      await then.task('Release 7').exists()
    })
  })

  test('given.toolPrefs gates the advertised toolset and then.task.absent passes for missing tasks', async () => {
    await executeScenario('tool prefs fixture', async ({ given, when, then, world }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)
      const instance = given.taskInstance()
      given.assign(dm, instance)
      given.toolPrefs(dm, { riskDefaults: {}, domainDefaults: {}, toolOverrides: { create_task: 'deny' } })
      given.llm([callCapability('tasks.list', {}), answer('cannot create')])

      await when.message(alice, dm, 'Create task Nope')

      then.replyTo(alice).equals('cannot create')
      const last = world.model.inspections().at(-1)
      expect(last?.availableTools).not.toContain('create_task')
      expect(last?.availableTools).toContain('list_tasks')
      expect(() => world.runtime.resolveToolCapability('tasks.create')).toThrow('Unknown tool capability id')
      expect(world.runtime.resolveToolCapability('tasks.list')).toBe('list_tasks')
      await then.task('Nope').absent()
    })
  })

  test('task capability prerequisite accepts implemented comment operations before startup', async () => {
    const world = await createScenarioWorld('comment task capabilities')

    try {
      const capabilities: TaskCapability[] = [
        'comments.read',
        'comments.create',
        'comments.update',
        'comments.delete',
        'comments.reactions',
      ]

      world.api.given.taskCapabilities(capabilities)

      expect([...world.tasks.capabilities]).toEqual(capabilities)
      expect(world.events.all().some(({ kind }) => kind === 'runtime.start.begin')).toBe(false)
    } finally {
      await world.stop()
    }
  })

  test('task capability prerequisite accepts implemented label operations', async () => {
    const world = await createScenarioWorld('label task capabilities')

    try {
      const capabilities: TaskCapability[] = [
        'labels.list',
        'labels.create',
        'labels.update',
        'labels.delete',
        'labels.assign',
      ]

      world.api.given.taskCapabilities(capabilities)

      expect([...world.tasks.capabilities]).toEqual(capabilities)
      expect(world.events.all().some(({ kind }) => kind === 'runtime.start.begin')).toBe(false)
    } finally {
      await world.stop()
    }
  })

  test('task capability prerequisite is blocked after startup', async () => {
    const world = await createScenarioWorld('task capability startup guard')

    try {
      await world.ensureStarted()

      expect(() => world.api.given.taskCapabilities([])).toThrow(
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

  test('coding credential and known-session prerequisites expose scoped setup through public assertions', async () => {
    await executeScenario('coding session fixture prerequisites', ({ given, then, world }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)

      given.codingCredentials({
        context: dm,
        updatedBy: alice.id,
        agentProvider: { agent: 'claude', provider: 'anthropic', apiKey: 'scenario-provider-key' },
        forge: { kind: 'github', token: 'scenario-forge-token' },
      })
      given.knownCodingSession(dm, 'known-session', {
        project: 'papai',
        title: 'Known coding work',
        createdAt: '2026-01-01T00:00:00.000Z',
      })

      then.codingSessions(dm).count(1)
      then.codingSessions(dm).session('known-session').matches({ project: 'papai', title: 'Known coding work' })
      then.codingSessions(dm).session('known-session').equals({
        project: 'papai',
        title: 'Known coding work',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      then.codingSessions(dm).session('missing-session').absent()
      expect(world.events.all().some(({ kind }) => kind === 'runtime.start.begin')).toBe(false)
    })
  })

  test('coding MCP prerequisite writes an external catalog selection without starting the runtime', async () => {
    await executeScenario('coding MCP fixture prerequisite', ({ given, world }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)

      given.codingMcp({
        context: dm,
        updatedBy: alice.id,
        catalog: [
          {
            name: 'docs',
            upstreamUrl: 'https://mcp.example.invalid/v1',
            header: 'X-Docs-Key',
            defaultToolPolicy: 'ask',
            toolPolicy: { search: 'allow' },
          },
        ],
        selections: [{ server: 'docs', upstreamToken: 'scenario-mcp-token' }],
      })

      const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
      expect(resolveMcpServers(contextId, alice.id)).toEqual({
        ok: true,
        servers: [
          {
            id: 'docs',
            url: 'https://mcp.example.invalid/v1',
            host: 'mcp.example.invalid',
            header: 'X-Docs-Key',
            allowedHosts: ['mcp.example.invalid'],
            toolPolicy: { default: 'ask', tools: { search: 'allow' } },
          },
        ],
      })
      expect(world.events.all().some(({ kind }) => kind === 'runtime.start.begin')).toBe(false)
    })
  })

  test('coding MCP prerequisite preserves deliberately malformed settings for fail-closed coverage', async () => {
    await executeScenario('malformed coding MCP fixture prerequisite', ({ given, world }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)

      given.codingMcp({
        context: dm,
        updatedBy: alice.id,
        catalog: [],
        malformedSettings: '{not-valid-json',
      })

      const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
      expect(resolveMcpServers(contextId, alice.id)).toEqual({ ok: false, error: 'MCP settings are malformed' })
      expect(world.events.all().some(({ kind }) => kind === 'runtime.start.begin')).toBe(false)
    })
  })

  test('coding project prerequisite writes a scoped project without starting the runtime', async () => {
    await executeScenario('coding project fixture prerequisite', ({ given, world }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)

      given.codingProject({
        context: dm,
        updatedBy: alice.id,
        name: 'papai',
        repoUrl: 'https://github.com/acme/papai.git',
        additionalEgressDomains: ['packages.acme.invalid'],
      })

      const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
      expect(getRepoByName(contextId, 'papai')).toMatchObject({
        name: 'papai',
        repoUrl: 'https://github.com/acme/papai.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
        additionalEgressDomains: ['packages.acme.invalid'],
      })
      expect(world.events.all().some(({ kind }) => kind === 'runtime.start.begin')).toBe(false)
    })
  })

  test('admin prerequisite seeds the admin role without starting the runtime', async () => {
    const world = await createScenarioWorld('admin prerequisite')

    try {
      const carol = world.api.given.user('carol')
      const root = world.api.given.user('root')

      world.api.given.admin(carol)
      world.api.given.admin(root, { superAdmin: true })

      expect(isAdmin(carol.id, carol.platformInstanceId)).toBe(true)
      expect(isSuperAdmin(carol.id)).toBe(false)
      expect(isAdmin(root.id, root.platformInstanceId)).toBe(true)
      expect(isSuperAdmin(root.id)).toBe(true)
      expect(world.events.all().some(({ kind }) => kind === 'runtime.start.begin')).toBe(false)

      await world.ensureStarted()
      expect(() => world.api.given.admin(carol)).toThrow('given.admin requires an unstarted scenario world')
    } finally {
      await world.stop()
    }
  })

  test('reply history assertion preserves all replies from a multi-turn conversation', async () => {
    await executeScenario('reply history assertion', async ({ given, when, then }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)
      given.llm([answer('First reply.'), answer('Second reply.')])

      await when.message(alice, dm, 'First turn')
      await when.message(alice, dm, 'Second turn')

      then.repliesTo(alice).equal(['First reply.', 'Second reply.'])
    })
  })

  test('replyTo.contains asserts a substring of the latest reply', async () => {
    await executeScenario('contains matcher', async ({ given, when, then }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)
      given.llm([answer('the code is xyzzy — do not share it')])

      await when.message(alice, dm, 'give me a secret')

      then.replyTo(alice).contains('the code is')
      then.replyTo(alice).contains('do not share it')
      expect(() => then.replyTo(alice).contains('not present')).toThrow()
    })
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

  test('debugEnabled world option unlocks the debug-gated 404 → 401 boundary', async () => {
    await executeScenario('debug-gate-off', async ({ when, then }) => {
      then.responseStatus(await when.request('/debug'), 404)
    })
    await executeScenario(
      'debug-gate-on',
      async ({ when, then }) => {
        then.responseStatus(await when.request('/debug'), 401)
      },
      undefined,
      { debugEnabled: true },
    )
  })

  test('then.responseJson traces contains/equals assertions against a parsed body', async () => {
    await executeScenario('response-json', ({ then }) => {
      then.responseJson({ principal: { display: 'bob' } }).contains('bob')
      then.responseJson({ ok: true }).equals({ ok: true })
    })
  })

  test('given.dashboardSession authorizes a dashboard-gated route that rejects anonymous callers', async () => {
    await executeScenario('dashboard-session', async ({ given, when, then }) => {
      const anon = await when.request('/admin/identity/mappings')
      then.responseStatus(anon, 401)
      const session = await given.dashboardSession()
      const authorized = await when.dashboardRequest(session, '/admin/identity/mappings')
      then.responseStatus(authorized, 200)
    })
  })

  test('given.notifyToken seeds a token isolated per scenario despite the module cache', async () => {
    await executeScenario('notify-token-a', ({ given }) => {
      given.notifyToken('token-alpha')
      expect(getNotifyToken()).toBe('token-alpha')
    })
    // A later scenario in the same worker must not see the previous cached token.
    await executeScenario('notify-token-b', () => {
      expect(getNotifyToken()).toBeNull()
    })
  })

  test('given.publicBaseUrl sets and restores SETTINGS_PUBLIC_BASE_URL around the scenario', async () => {
    expect(process.env['SETTINGS_PUBLIC_BASE_URL']).toBeUndefined()
    await executeScenario('public-base-url', ({ given }) => {
      given.publicBaseUrl('https://settings.example')
      expect(process.env['SETTINGS_PUBLIC_BASE_URL']).toBe('https://settings.example')
    })
    expect(process.env['SETTINGS_PUBLIC_BASE_URL']).toBeUndefined()
  })

  test('given.allowPublicUrl bypasses the public-URL guard inside the scenario and restores it after', async () => {
    await executeScenario('allow-public-url', async ({ given }) => {
      given.allowPublicUrl()
      // Guard bypassed: a loopback literal the real guard would reject now passes
      // assertPublicUrl and reaches fetch, which the pre-aborted signal rejects before
      // any connection — so the classified error is a timeout/abort, NOT blocked-host.
      const active = await safeFetchContent('http://[::ffff:127.0.0.1]/', {
        abortSignal: AbortSignal.abort(),
      }).catch((error: unknown) => error)
      expectAppError(active, getUserMessage(webFetchError.timeout()))
    })
    // After teardown the real guard is restored: the same loopback literal is rejected
    // with blocked-host (synchronously, no DNS, no network).
    const restored = await safeFetchContent('http://[::ffff:127.0.0.1]/', {
      abortSignal: AbortSignal.timeout(1000),
    }).catch((error: unknown) => error)
    expectAppError(restored, getUserMessage(webFetchError.blockedHost()))
  })

  test('given.recurringTask + when.recurringTick fires a due recurrence into the world provider and notifies', async () => {
    await executeScenario('recurring-fire-seam', async ({ given, when, then }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)
      given.assign(dm, given.taskInstance())
      given.recurringTask(dm, {
        title: 'Water the plants',
        nextRun: '2020-01-01T09:00:00.000Z',
        rrule: 'FREQ=DAILY',
        dtstartUtc: '2020-01-01T09:00:00.000Z',
      })
      await when.recurringTick()
      await then.task('Water the plants').exists()
      then.replyTo(alice).contains('Water the plants')
    })
  })

  test('given.scheduledPrompt + when.scheduledPoll fires a due prompt and delivers a proactive message', async () => {
    await executeScenario('scheduled-fire-seam', async ({ given, when, then, world }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)
      // The scenario world already seeds system LLM config during startup
      // (see world.ts's `fixtures.seedSystemLlmConfig()` call); there is no
      // `given.seedSystemLlmConfig` DSL member to call here.
      world.http.expect({ method: 'POST', url: 'https://llm.invalid/v1/chat/completions' }, () =>
        Response.json({
          id: 'chatcmpl-sched-1',
          choices: [
            {
              message: { role: 'assistant', content: 'Stand-up starts now.' },
              finish_reason: 'stop',
            },
          ],
        }),
      )
      given.scheduledPrompt(dm, {
        prompt: 'Remind me: stand-up',
        fireAt: '2020-01-01T09:00:00.000Z',
      })
      // Contract tests (`--contracts`) run without `tests/stories/preload.ts` (see
      // scripts/story/child.ts), so the story I/O guard's global `fetch` patch that
      // normally reroutes outbound calls through `world.http` is never installed.
      // The deferred-prompt poller drives a real AI SDK `generateText` call for the
      // lightweight scheduled-prompt execution, which goes through `globalThis.fetch`
      // directly. Bridge it to the scenario's strict HTTP dispatcher — which still
      // enforces the declared expectation and its single-consumption contract
      // regardless of the guard — for the duration of the poll only.
      setMockFetch((url, init) => world.http.fetch(url, init))
      try {
        await when.scheduledPoll()
      } finally {
        restoreFetch()
      }
      then.replyTo(alice).contains('Stand-up')
    })
  })
})
