// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildExecutionFamilyProps } from '../../src/analytics/normalizer-props-execution.js'
import { createFactKeyDeriver } from '../../src/analytics/normalizer-shared.js'
import type { AnalyticsSourceContext, ConfirmationRequestedFact } from '../../src/analytics/source-facts.js'
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

describe('normalizer-props-execution', () => {
  test('confirmation_requested rejects a non-standard timeout', () => {
    const fact: ConfirmationRequestedFact = {
      version: 1,
      type: 'confirmation_requested',
      sourceEventId: 'se-cr-bad',
      occurredAtMs: 1_700_000_001_000,
      source,
      toolSlug: 'core_task_delete',
      toolOrigin: 'core',
      risk: 'destructive',
      timeoutMs: 60_000,
    }
    expect(buildExecutionFamilyProps(fact, keys)).toEqual({ ok: false, reason: 'invalid_value' })
  })
})
