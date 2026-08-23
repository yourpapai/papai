// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildBoundaryFamilyProps } from '../../src/analytics/normalizer-props-boundary.js'
import { createFactKeyDeriver } from '../../src/analytics/normalizer-shared.js'
import type { AnalyticsSourceContext, ProviderRequestCompletedFact } from '../../src/analytics/source-facts.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'

const source: AnalyticsSourceContext = {
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-42',
  nativeContextId: 'user-42',
  storageContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  configContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-raw-1',
}

const keys = createFactKeyDeriver({ key: Buffer.alloc(32, 7), keyVersion: 'v1' })

describe('normalizer-props-boundary', () => {
  test('provider_request_completed accepts the github provider', () => {
    const fact: ProviderRequestCompletedFact = {
      version: 1,
      type: 'provider_request_completed',
      sourceEventId: 'se-prc-github',
      occurredAtMs: 1_700_000_001_600,
      source,
      provider: 'github',
      operation: 'read',
      durationMs: 10,
      outcome: 'success',
      statusClass: '2xx',
      retryable: null,
    }
    expect(buildBoundaryFamilyProps(fact, keys)).toEqual({
      ok: true,
      props: {
        provider: 'github',
        operation: 'read',
        duration_ms: 10,
        outcome: 'success',
        status_class: '2xx',
        retryable: null,
      },
    })
  })

  test('provider_request_completed rejects an unknown status class', () => {
    const fact: ProviderRequestCompletedFact = {
      version: 1,
      type: 'provider_request_completed',
      sourceEventId: 'se-prc-bad',
      occurredAtMs: 1_700_000_001_600,
      source,
      provider: 'kaneo',
      operation: 'read',
      durationMs: 10,
      outcome: 'success',
      statusClass: 'HTTP 200 OK',
      retryable: null,
    }
    expect(buildBoundaryFamilyProps(fact, keys)).toEqual({ ok: false, reason: 'unknown_enum' })
  })
})
