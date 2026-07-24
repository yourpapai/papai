// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ANALYTICS_EVENT_REGISTRY_V1 } from '../../src/analytics/registry.js'
import type { AnalyticsSourceContext, AnalyticsSourceFact } from '../../src/analytics/source-facts.js'
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

describe('source-facts', () => {
  test('fact variants discriminate on the registry event names', () => {
    const fact: AnalyticsSourceFact = {
      version: 1,
      type: 'chat_message_accepted',
      sourceEventId: 'se-001',
      occurredAtMs: 1_700_000_000_000,
      source,
      inputCount: 1,
      inputLengthChars: 200,
      attachmentCount: 0,
      isCommand: false,
      command: 'none',
    }
    expect(fact.type).toBe('chat_message_accepted')
    expect(ANALYTICS_EVENT_REGISTRY_V1.eventNames).toContain(fact.type)
    expect(ANALYTICS_EVENT_REGISTRY_V1.eventNames).toHaveLength(32)
  })
})
