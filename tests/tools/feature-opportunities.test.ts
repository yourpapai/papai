// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  createFeatureObserver,
  FEATURE_V1,
  setFeatureObserverForTesting,
} from '../../src/analytics/feature-observer.js'
import type { AnalyticsRequestContext } from '../../src/analytics/provider-observer.js'
import {
  createActorProviderRequestScope,
  NO_ANALYTICS_SCOPE,
  runWithProviderRequestScope,
} from '../../src/analytics/provider-request-scope.js'
import type { AnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsSourceContext, AnalyticsSourceFact } from '../../src/analytics/source-facts.js'
import { observeFeatureOpportunities } from '../../src/tools/feature-opportunities.js'
import { mockLogger } from '../utils/test-helpers.js'

const source: AnalyticsSourceContext = {
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
}

const requestContext: AnalyticsRequestContext = { source, sourceEventId: 'turn-1:opportunities' }

describe('observeFeatureOpportunities', () => {
  let facts: AnalyticsSourceFact[]

  const observer: AnalyticsObserver = {
    observe: (fact) => {
      facts.push(fact)
    },
    flush: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  }

  beforeEach(() => {
    mockLogger()
    facts = []
    setFeatureObserverForTesting(createFeatureObserver(observer))
  })

  afterEach(() => {
    setFeatureObserverForTesting(null)
  })

  const input = {
    mode: 'normal' as const,
    contextType: 'dm' as const,
    hasProvider: true,
    hasChatUser: true,
    codingPluginActive: false,
    mcpToolCount: 0,
  }

  test('emits one content-free opportunity per registered feature under an actor scope', async () => {
    const scope = createActorProviderRequestScope({ requestContext, observeProviderRequest: () => {} })
    await runWithProviderRequestScope(scope, () => {
      observeFeatureOpportunities(input)
    })
    const opportunities = facts.filter((fact) => fact.type === 'feature_opportunity')
    expect(opportunities.map((fact) => (fact as { feature: string }).feature).sort()).toEqual([...FEATURE_V1].sort())
    expect(JSON.stringify(opportunities)).not.toContain('user-1:chat')
  })

  test('emits nothing under NO_ANALYTICS_SCOPE and never infers from use', async () => {
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () => {
      observeFeatureOpportunities(input)
    })
    expect(facts).toHaveLength(0)
  })

  test('skips silently when no observer is bound', async () => {
    setFeatureObserverForTesting(null)
    const scope = createActorProviderRequestScope({ requestContext, observeProviderRequest: () => {} })
    await runWithProviderRequestScope(scope, () => {
      expect(() => observeFeatureOpportunities(input)).not.toThrow()
    })
    expect(facts).toHaveLength(0)
  })
})
