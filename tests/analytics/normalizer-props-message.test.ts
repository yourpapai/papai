// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildMessageFamilyProps } from '../../src/analytics/normalizer-props-message.js'
import type { AnalyticsSourceContext, TurnStartedFact } from '../../src/analytics/source-facts.js'
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

describe('normalizer-props-message', () => {
  test('turn_started rejects a negative queue wait', () => {
    const fact: TurnStartedFact = {
      version: 1,
      type: 'turn_started',
      sourceEventId: 'se-ts-neg',
      occurredAtMs: 1_700_000_000_200,
      source,
      incomingMessageCount: 1,
      attachmentCount: 0,
      queueWaitMs: -5,
    }
    expect(buildMessageFamilyProps(fact)).toEqual({ ok: false, reason: 'invalid_value' })
  })
})
