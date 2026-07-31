// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { createFeatureObserver, setFeatureObserverForTesting } from '../../../src/analytics/feature-observer.js'
import type { AnalyticsRequestContext } from '../../../src/analytics/provider-observer.js'
import {
  createActorProviderRequestScope,
  runWithProviderRequestScope,
} from '../../../src/analytics/provider-request-scope.js'
import type { AnalyticsObserver } from '../../../src/analytics/runtime.js'
import type { AnalyticsSourceContext, AnalyticsSourceFact } from '../../../src/analytics/source-facts.js'
import type { PluginToolRuntimeContext } from '../../../src/plugins/types.js'
import { mockLogger } from '../../utils/test-helpers.js'
import { activate, jsonResponse, options, runtimeCtx } from './support.js'
import type { FakeCodingRepos, HttpFetch } from './support.js'

const source: AnalyticsSourceContext = {
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-1',
  nativeContextId: 'chat-1',
  storageContextId: 'pi-1:chat-1',
  configContextId: 'pi-1:chat-1',
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-1',
}

const requestContext: AnalyticsRequestContext = { source, sourceEventId: 'turn-1:acp-unconfigured' }

const facts: AnalyticsSourceFact[] = []
const recordingObserver: AnalyticsObserver = {
  observe: (fact) => {
    facts.push(fact)
  },
  flush: () => Promise.resolve(),
  stop: () => Promise.resolve(),
}

const unconfiguredFacts = (): Extract<AnalyticsSourceFact, { type: 'unconfigured_reply' }>[] =>
  facts.filter(
    (fact): fact is Extract<AnalyticsSourceFact, { type: 'unconfigured_reply' }> => fact.type === 'unconfigured_reply',
  )

const actorScope = (): ReturnType<typeof createActorProviderRequestScope> =>
  createActorProviderRequestScope({ requestContext, observeProviderRequest: () => {} })

const okFetch: HttpFetch = () => Promise.resolve(jsonResponse({ sessionId: 'sess-1', url: 'http://magi/s/sess-1' }))

const withSecrets = (
  base: PluginToolRuntimeContext,
  overrides: Partial<PluginToolRuntimeContext['codingSecrets']>,
): PluginToolRuntimeContext => ({ ...base, codingSecrets: { ...base.codingSecrets, ...overrides } })

const selfHostedRepos: FakeCodingRepos = {
  list: () => [{ name: 'demo', baseBranch: 'main' }],
  get: (name: string) =>
    name === 'demo'
      ? {
          name: 'demo',
          repoUrl: 'https://git.self-hosted.example/acme/demo.git',
          baseBranch: 'main',
          permissionPreset: 'cautious',
        }
      : null,
}

beforeEach(() => {
  mockLogger()
  facts.length = 0
  setFeatureObserverForTesting(createFeatureObserver(recordingObserver))
})

afterEach(() => {
  setFeatureObserverForTesting(null)
})

describe('acp unconfigured_reply producers', () => {
  test('start_session without coding credentials emits one coding_credentials fact', async () => {
    const { tools } = activate(okFetch)
    const ctx = withSecrets(runtimeCtx(), { resolve: () => null })
    const result: unknown = await runWithProviderRequestScope(actorScope(), () =>
      tools.get('start_session')!.execute({ project: 'demo', prompt: 'fix it' }, ctx, options()),
    )
    expect(result).toMatchObject({ error: 'not_configured' })
    const emitted = unconfiguredFacts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ missing: 'coding_credentials', surface: 'coding' })
  })

  test('start_session on a self-hosted host without forge config emits forge_credentials', async () => {
    const { tools } = activate(okFetch)
    const ctx = runtimeCtx(undefined, selfHostedRepos)
    const result: unknown = await runWithProviderRequestScope(actorScope(), () =>
      tools.get('start_session')!.execute({ project: 'demo', prompt: 'fix it' }, ctx, options()),
    )
    expect(result).toMatchObject({ error: 'not_configured' })
    const emitted = unconfiguredFacts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ missing: 'forge_credentials', surface: 'coding' })
  })

  test('start_session on a PR without a forge token emits forge_credentials', async () => {
    const { tools } = activate(okFetch)
    const ctx = withSecrets(runtimeCtx(), { resolveForgeToken: () => null })
    const result: unknown = await runWithProviderRequestScope(actorScope(), () =>
      tools.get('start_session')!.execute({ project: 'demo', prompt: 'review', prNumber: 7 }, ctx, options()),
    )
    expect(result).toMatchObject({ error: 'not_configured' })
    const emitted = unconfiguredFacts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ missing: 'forge_credentials', surface: 'coding' })
  })

  test('start_session with full credentials emits no unconfigured fact', async () => {
    const { tools } = activate(okFetch)
    const result: unknown = await runWithProviderRequestScope(actorScope(), () =>
      tools.get('start_session')!.execute({ project: 'demo', prompt: 'fix it' }, runtimeCtx(), options()),
    )
    expect(result).not.toMatchObject({ error: 'not_configured' })
    expect(unconfiguredFacts()).toHaveLength(0)
  })

  test('finish_session without a forge token emits forge_credentials', async () => {
    const { tools } = activate(okFetch)
    const ctx = withSecrets(runtimeCtx(), { resolveForgeToken: () => null })
    const result: unknown = await runWithProviderRequestScope(actorScope(), () =>
      tools.get('finish_session')!.execute({ sessionId: 'sess-1', action: 'push' }, ctx, options()),
    )
    expect(result).toMatchObject({ error: 'not_configured' })
    const emitted = unconfiguredFacts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ missing: 'forge_credentials', surface: 'coding' })
  })

  test('continue_session without coding credentials emits coding_credentials', async () => {
    const { tools } = activate(okFetch)
    const ctx = withSecrets(runtimeCtx(), { resolve: () => null })
    const result: unknown = await runWithProviderRequestScope(actorScope(), () =>
      tools.get('continue_session')!.execute({ sessionId: 'sess-1', prompt: 'go on' }, ctx, options()),
    )
    expect(result).toMatchObject({ error: 'not_configured' })
    const emitted = unconfiguredFacts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ missing: 'coding_credentials', surface: 'coding' })
  })

  test('continue_session without a forge token emits forge_credentials', async () => {
    const { tools } = activate(okFetch)
    const ctx = withSecrets(runtimeCtx(), { resolveForgeToken: () => null })
    const result: unknown = await runWithProviderRequestScope(actorScope(), () =>
      tools.get('continue_session')!.execute({ sessionId: 'sess-1', prompt: 'go on' }, ctx, options()),
    )
    expect(result).toMatchObject({ error: 'not_configured' })
    const emitted = unconfiguredFacts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ missing: 'forge_credentials', surface: 'coding' })
  })

  test('no unconfigured fact when no actor scope is active', async () => {
    const fetchMock = mock(okFetch)
    const { tools } = activate(fetchMock)
    const ctx = withSecrets(runtimeCtx(), { resolve: () => null })
    const result: unknown = await tools.get('start_session')!.execute({ project: 'demo', prompt: 'x' }, ctx, options())
    expect(result).toMatchObject({ error: 'not_configured' })
    expect(unconfiguredFacts()).toHaveLength(0)
  })
})
