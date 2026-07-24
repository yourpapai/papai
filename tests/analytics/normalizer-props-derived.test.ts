// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildDerivedFamilyProps } from '../../src/analytics/normalizer-props-derived.js'
import { createFactKeyDeriver } from '../../src/analytics/normalizer-shared.js'
import type { AnalyticsSourceContext, ClarificationAbandonedFact } from '../../src/analytics/source-facts.js'
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

describe('normalizer-props-derived', () => {
  test('clarification_abandoned rejects a non-24 observation window', () => {
    const fact: ClarificationAbandonedFact = {
      version: 1,
      type: 'clarification_abandoned',
      sourceEventId: 'se-ca-bad',
      occurredAtMs: 1_700_000_002_700,
      source,
      observationHours: 12,
    }
    expect(buildDerivedFamilyProps(fact, keys)).toEqual({ ok: false, reason: 'invalid_value' })
  })
})
