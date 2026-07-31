// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

import { callMagi } from '../../plugins/acp/client.js'
import { kaneoProvision } from '../../plugins/task-provider-kaneo/auto-provision.js'
import { kaneoFetch, type KaneoConfig } from '../../plugins/task-provider-kaneo/client.js'
import { KaneoClient } from '../../plugins/task-provider-kaneo/kaneo-client.js'
import { youtrackFetch, type YouTrackConfig } from '../../plugins/task-provider-youtrack/client.js'
import { YouTrackCollaborationProvider } from '../../plugins/task-provider-youtrack/collaboration-provider.js'
import { createYouTrackIdentityResolver } from '../../plugins/task-provider-youtrack/identity-resolver.js'
import type { AnalyticsRequestContext, ProviderRequestObservation } from '../../src/analytics/provider-observer.js'
import {
  createActorProviderRequestScope,
  NO_ANALYTICS_SCOPE,
  ProviderScopeMissingError,
  runWithoutProviderRequestScope,
  runWithProviderRequestScope,
} from '../../src/analytics/provider-request-scope.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'
import type { ReplyFn } from '../../src/chat/types.js'
import { attemptAutoLink } from '../../src/identity/resolver.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { maybeAutoProvisionProvider } from '../../src/providers/auto-provision.js'
import { runMembershipBackfill } from '../../src/providers/membership/backfill.js'
import { ensureWorkspaceMember, type MembershipDeps } from '../../src/providers/membership/ensure-member.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, restoreFetch, setMockFetch, setupTestDb } from '../utils/test-helpers.js'

const KANEO: KaneoConfig = { apiKey: 'setup-key', baseUrl: 'https://kaneo.setup.example' }
const YOUTRACK: YouTrackConfig = { baseUrl: 'https://youtrack.setup.example', token: 'setup-token' }

const makeSource = (overrides: Partial<AnalyticsSourceContext> = {}): AnalyticsSourceContext => ({
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-1',
  nativeContextId: 'chat-1',
  storageContextId: 'pi-1:chat-1',
  configContextId: 'pi-1:chat-1',
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: 'ti-1',
  taskProvider: 'kaneo',
  invocationMode: 'normal',
  rawTurnId: 'turn-1',
  ...overrides,
})

type Recorder = Readonly<{
  observations: ProviderRequestObservation[]
  contexts: AnalyticsRequestContext[]
  actorScope: (source?: AnalyticsSourceContext) => ReturnType<typeof createActorProviderRequestScope>
}>

const createRecorder = (): Recorder => {
  const observations: ProviderRequestObservation[] = []
  const contexts: AnalyticsRequestContext[] = []
  return {
    observations,
    contexts,
    actorScope: (source = makeSource()) =>
      createActorProviderRequestScope({
        requestContext: { source, sourceEventId: 'turn-1:setup-paths' },
        observeProviderRequest: (ctx, observation) => {
          contexts.push(ctx)
          observations.push(observation)
        },
      }),
  }
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const reply: ReplyFn = {
  text: () => Promise.resolve(),
  formatted: () => Promise.resolve(),
  typing: () => {},
  buttons: () => Promise.resolve(undefined),
}

let recorder: Recorder

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
  recorder = createRecorder()
})

describe('boundaries fail before any fetch I/O when the scope is omitted', () => {
  test('kaneoFetch, youtrackFetch, and callMagi throw the controlled failure before fetching', async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse({})))
    setMockFetch(fetchMock)
    try {
      await runWithoutProviderRequestScope(() =>
        expect(kaneoFetch(KANEO, 'GET', '/tasks/1', undefined, undefined, z.unknown())).rejects.toThrow(
          ProviderScopeMissingError,
        ),
      )
      await runWithoutProviderRequestScope(() =>
        expect(youtrackFetch(YOUTRACK, 'GET', '/api/issues/1')).rejects.toThrow(ProviderScopeMissingError),
      )
      const httpFetch = mock(() => Promise.resolve(new Response('null', { status: 200 })))
      await runWithoutProviderRequestScope(() =>
        expect(callMagi(httpFetch, { baseUrl: 'https://magi.example', token: 't' }, 'GET', '/status')).rejects.toThrow(
          ProviderScopeMissingError,
        ),
      )
      expect(fetchMock).not.toHaveBeenCalled()
      expect(httpFetch).not.toHaveBeenCalled()
    } finally {
      restoreFetch()
    }
  })
})

describe('auto-provision contributed registry hook', () => {
  const PLUGIN_ID = 'setup-paths-plugin'
  const TYPE = 'setup-paths-provider'

  const registerHook = (): void => {
    registerContributedTaskProviderType(TYPE, {
      pluginId: PLUGIN_ID,
      factory: () => createMockProvider({ name: TYPE }),
      autoProvision: (context) =>
        runWithProviderRequestScope(context.scope, () =>
          kaneoFetch(KANEO, 'GET', '/users/me', undefined, undefined, z.unknown()).then(() => true),
        ),
      capabilities: new Set(),
      displayName: 'Setup Paths',
    })
  }

  beforeEach(() => {
    insertPlatformInstance({ id: 'pi-1', type: 'telegram', config: {}, status: 'active' })
    insertTaskInstance({ id: 'ti-1', type: TYPE, config: {}, status: 'active' })
    setContextSettings({ contextId: 'pi-1:chat-1', taskInstanceId: 'ti-1', platformInstanceId: 'pi-1' })
    registerHook()
  })

  test('actor attribution when the scope is explicit', async () => {
    setMockFetch(() => Promise.resolve(jsonResponse({ id: 'me' })))
    try {
      const result = await maybeAutoProvisionProvider(reply, 'pi-1:chat-1', 'user-1', 'alice', recorder.actorScope())
      expect(result).toBe(true)
      expect(recorder.observations).toHaveLength(1)
      expect(recorder.observations[0]).toMatchObject({ provider: 'kaneo', outcome: 'success' })
      expect(recorder.contexts[0]?.source.chatUserId).toBe('user-1')
    } finally {
      restoreFetch()
      unregisterContributedTaskProviderType(PLUGIN_ID)
    }
  })

  test('no fact under NO_ANALYTICS_SCOPE', async () => {
    setMockFetch(() => Promise.resolve(jsonResponse({ id: 'me' })))
    try {
      const result = await maybeAutoProvisionProvider(reply, 'pi-1:chat-1', 'user-1', null, NO_ANALYTICS_SCOPE)
      expect(result).toBe(true)
      expect(recorder.observations).toHaveLength(0)
    } finally {
      restoreFetch()
      unregisterContributedTaskProviderType(PLUGIN_ID)
    }
  })
})

describe('membership ensure and reuse', () => {
  const membershipDeps = (
    provision: () => Promise<{ providerUserId: string; login: string; password: string }>,
  ): MembershipDeps => ({
    resolveProvider: (): Promise<ReturnType<typeof createMockProvider> | null> =>
      Promise.resolve(
        createMockProvider({
          name: 'kaneo',
          capabilities: new Set(['members.provision']),
          provisionWorkspaceMember: provision,
        }),
      ),
    getContextSettings: (): { taskInstanceId: string | null; platformInstanceId: string } | null => ({
      taskInstanceId: 'ti-1',
      platformInstanceId: 'pi-1',
    }),
    resolveUserLabel: (): Promise<string | null> => Promise.resolve('Alice'),
  })

  const provisioningFetch = (): Promise<{ providerUserId: string; login: string; password: string }> =>
    kaneoFetch(KANEO, 'POST', '/auth/sign-up', { email: 'a@b.c' }, undefined, z.unknown()).then(() => ({
      providerUserId: 'ku-1',
      login: 'a@b.c',
      password: 'pw',
    }))

  test('provision path attributes to the explicit actor scope', async () => {
    setMockFetch(() => Promise.resolve(jsonResponse({ id: 'ku-1' })))
    try {
      const outcome = await ensureWorkspaceMember(
        'grp-1',
        'user-1',
        recorder.actorScope(),
        membershipDeps(provisioningFetch),
      )
      expect(outcome).toBe('created')
      expect(recorder.observations).toHaveLength(1)
      expect(recorder.contexts[0]?.source.chatUserId).toBe('user-1')
    } finally {
      restoreFetch()
    }
  })

  test('provision path emits no fact under NO_ANALYTICS_SCOPE and reuse performs no provider I/O', async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse({ id: 'ku-1' })))
    setMockFetch(fetchMock)
    try {
      const created = await ensureWorkspaceMember(
        'grp-1',
        'user-1',
        NO_ANALYTICS_SCOPE,
        membershipDeps(provisioningFetch),
      )
      expect(created).toBe('created')
      expect(recorder.observations).toHaveLength(0)
      fetchMock.mockClear()
      const reused = await ensureWorkspaceMember(
        'grp-1',
        'user-1',
        recorder.actorScope(),
        membershipDeps(provisioningFetch),
      )
      expect(reused).toBe('exists')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(recorder.observations).toHaveLength(0)
    } finally {
      restoreFetch()
    }
  })
})

describe('host identity auto-link', () => {
  const providerWithResolver = (): ReturnType<typeof createMockProvider> =>
    createMockProvider({
      name: 'kaneo',
      identityResolver: {
        searchUsers: (query: string) =>
          kaneoFetch(
            KANEO,
            'GET',
            '/users',
            undefined,
            { query },
            z.array(z.object({ id: z.string(), login: z.string(), name: z.string().optional() })),
          ),
      },
    })

  test('actor attribution when the scope is explicit', async () => {
    setMockFetch(() => Promise.resolve(jsonResponse([])))
    try {
      await attemptAutoLink('user-1', 'alice', providerWithResolver(), recorder.actorScope())
      expect(recorder.observations).toHaveLength(1)
      expect(recorder.contexts[0]?.source.chatUserId).toBe('user-1')
    } finally {
      restoreFetch()
    }
  })

  test('no fact under NO_ANALYTICS_SCOPE', async () => {
    setMockFetch(() => Promise.resolve(jsonResponse([])))
    try {
      await attemptAutoLink('user-1', 'alice', providerWithResolver(), NO_ANALYTICS_SCOPE)
      expect(recorder.observations).toHaveLength(0)
    } finally {
      restoreFetch()
    }
  })
})

describe('settings provisioning hook', () => {
  const routeProvision = (url: string): Promise<Response> => {
    if (url.includes('/sign-up')) {
      return Promise.resolve(jsonResponse({ user: { id: 'u' }, token: 'session-cookie' }))
    }
    if (url.includes('/organization/create')) return Promise.resolve(jsonResponse({ id: 'ws-1', slug: 's' }))
    if (url.includes('/api-key/create')) return Promise.resolve(jsonResponse({ key: 'k' }))
    return Promise.resolve(jsonResponse({}))
  }

  test('actor attribution with the settings invocation mode', async () => {
    setMockFetch((url) => routeProvision(url))
    try {
      const scope = recorder.actorScope(makeSource({ invocationMode: 'settings' }))
      const outcome = await kaneoProvision({
        contextId: 'pi-1:chat-1',
        username: 'alice',
        publicUrl: 'https://k.example.com',
        internalUrl: 'https://k-internal.example.com',
        scope,
      })
      expect(outcome.status).toBe('provisioned')
      expect(recorder.observations.length).toBeGreaterThan(0)
      expect(recorder.contexts.every((ctx) => ctx.source.invocationMode === 'settings')).toBe(true)
      expect(recorder.contexts.every((ctx) => ctx.source.chatUserId === 'user-1')).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  test('no fact under NO_ANALYTICS_SCOPE', async () => {
    setMockFetch((url) => routeProvision(url))
    try {
      const outcome = await kaneoProvision({
        contextId: 'pi-1:chat-1',
        username: 'alice',
        publicUrl: 'https://k.example.com',
        internalUrl: 'https://k-internal.example.com',
        scope: NO_ANALYTICS_SCOPE,
      })
      expect(outcome.status).toBe('provisioned')
      expect(recorder.observations).toHaveLength(0)
    } finally {
      restoreFetch()
    }
  })
})

describe('startup membership backfill', () => {
  const members = [
    { groupId: 'grp-1', userId: 'user-1' },
    { groupId: 'grp-1', userId: 'user-2' },
  ]

  const scopedEnsure = (
    groupContextId: string,
    chatUserId: string,
    scope: Parameters<typeof runWithProviderRequestScope>[0],
  ): Promise<'created'> =>
    runWithProviderRequestScope(scope, () =>
      kaneoFetch(KANEO, 'POST', '/auth/sign-up', { chatUserId, groupContextId }, undefined, z.unknown()).then(
        () => 'created' as const,
      ),
    )

  test('startup NO_ANALYTICS_SCOPE performs the work with zero facts', async () => {
    setMockFetch(() => Promise.resolve(jsonResponse({ id: 'ku' })))
    try {
      const result = await runMembershipBackfill({
        scope: NO_ANALYTICS_SCOPE,
        listAllGroupMembers: () => members,
        ensure: scopedEnsure,
      })
      expect(result.created).toBe(2)
      expect(recorder.observations).toHaveLength(0)
    } finally {
      restoreFetch()
    }
  })

  test('an explicit actor scope attributes every bounded ensure call', async () => {
    setMockFetch(() => Promise.resolve(jsonResponse({ id: 'ku' })))
    try {
      const result = await runMembershipBackfill({
        scope: recorder.actorScope(),
        listAllGroupMembers: () => members,
        ensure: scopedEnsure,
      })
      expect(result.created).toBe(2)
      expect(recorder.observations).toHaveLength(2)
      expect(recorder.contexts.every((ctx) => ctx.source.chatUserId === 'user-1')).toBe(true)
    } finally {
      restoreFetch()
    }
  })
})

describe('youtrack inherited providers and identity resolver', () => {
  class ProbeCollaboration extends YouTrackCollaborationProvider {}

  test('inherited collaboration methods attribute to the explicit actor scope', async () => {
    setMockFetch(() => Promise.resolve(jsonResponse([])))
    try {
      const provider = new ProbeCollaboration(YOUTRACK)
      await runWithProviderRequestScope(recorder.actorScope(), () => provider.listUsers('alice'))
      expect(recorder.observations).toHaveLength(1)
      expect(recorder.observations[0]).toMatchObject({ provider: 'youtrack', outcome: 'success' })
      expect(recorder.contexts[0]?.source.chatUserId).toBe('user-1')
    } finally {
      restoreFetch()
    }
  })

  test('inherited collaboration methods emit no fact under NO_ANALYTICS_SCOPE', async () => {
    setMockFetch(() => Promise.resolve(jsonResponse([])))
    try {
      const provider = new ProbeCollaboration(YOUTRACK)
      await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () => provider.listUsers('alice'))
      expect(recorder.observations).toHaveLength(0)
    } finally {
      restoreFetch()
    }
  })

  test('the identity resolver search attributes to the actor scope and fails before fetch when omitted', async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse([])))
    setMockFetch(fetchMock)
    try {
      const resolver = createYouTrackIdentityResolver(YOUTRACK)
      await runWithProviderRequestScope(recorder.actorScope(), () => resolver.searchUsers('alice'))
      expect(recorder.observations).toHaveLength(1)
      expect(recorder.contexts[0]?.source.chatUserId).toBe('user-1')
      fetchMock.mockClear()
      await runWithoutProviderRequestScope(() => expect(resolver.searchUsers('alice')).rejects.toThrow())
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      restoreFetch()
    }
  })
})

describe('kaneo client and plugin entry', () => {
  test('the KaneoClient constructor and resource getters never snapshot the active frame', async () => {
    const scopeA = recorder.actorScope(makeSource({ chatUserId: 'user-a' }))
    const scopeB = recorder.actorScope(makeSource({ chatUserId: 'user-b' }))
    const client = new KaneoClient(KANEO)
    setMockFetch(() =>
      Promise.resolve(
        jsonResponse({ data: { id: 'proj-1', name: 'P', columns: [], archivedTasks: [], plannedTasks: [] } }),
      ),
    )
    try {
      await runWithProviderRequestScope(scopeA, () => client.projects)
      await runWithProviderRequestScope(scopeB, () => client.tasks.list('proj-1'))
      expect(recorder.observations).toHaveLength(1)
      expect(recorder.contexts[0]?.source.chatUserId).toBe('user-b')
    } finally {
      restoreFetch()
    }
  })

  test('constructing the client and reading getters requires no scope at all', () => {
    const client = new KaneoClient(KANEO)
    expect(client.tasks).toBeDefined()
    expect(client.projects).toBeDefined()
    expect(client.labels).toBeDefined()
    expect(client.comments).toBeDefined()
    expect(client.columns).toBeDefined()
  })
})

describe('boundary static closure', () => {
  const readSrc = (relativePath: string): string =>
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

  test('long-lived provider, plugin, and identity objects never reference the request scope', () => {
    const longLived = [
      '../../plugins/task-provider-kaneo/kaneo-client.ts',
      '../../plugins/task-provider-kaneo/index.ts',
      '../../plugins/task-provider-kaneo/provider.ts',
      '../../plugins/task-provider-kaneo/identity-resolver.ts',
      '../../plugins/task-provider-youtrack/provider.ts',
      '../../plugins/task-provider-youtrack/collaboration-provider.ts',
      '../../plugins/task-provider-youtrack/phase-five-provider.ts',
      '../../plugins/task-provider-youtrack/identity-resolver.ts',
      '../../plugins/acp/tools.ts',
      '../../plugins/acp/session-tools.ts',
      '../../plugins/acp/continue-tool.ts',
    ]
    for (const path of longLived) {
      expect(readSrc(path).includes('ProviderRequestScope'), path).toBe(false)
    }
  })

  test('every runWithProviderRequestScope call site awaits or returns the scoped promise', () => {
    const sites = [
      '../../src/providers/membership/ensure-member.ts',
      '../../src/identity/resolver.ts',
      '../../plugins/task-provider-kaneo/auto-provision.ts',
      '../../src/tools/wrap-tool-execution.ts',
      '../../src/debug/transcript-viewer.ts',
    ]
    for (const path of sites) {
      const lines = readSrc(path).split('\n')
      lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.includes('runWithProviderRequestScope('))
        .filter(({ line }) => !line.includes('import'))
        .forEach(({ index }) => {
          const settled = lines
            .slice(Math.max(0, index - 1), index + 1)
            .some((text) => /\bawait\b|\breturn\b|=>\s*$/u.test(text))
          expect(settled, `${path}:${String(index + 1)}`).toBe(true)
        })
    }
  })

  test('startup passes NO_ANALYTICS_SCOPE to the membership backfill', () => {
    const source = readSrc('../../src/runtime/production-deps.ts')
    expect(source).toContain('runMembershipBackfill({ ensure, scope: NO_ANALYTICS_SCOPE })')
  })
})
