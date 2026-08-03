// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildEditRegenFact, buildEditClassifiedFact } from '../../src/analytics/edit-observer.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'

const source: AnalyticsSourceContext = {
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-1',
  nativeContextId: 'user-1',
  storageContextId: 'pi-1:user-1',
  configContextId: 'pi-1:user-1',
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 't-1',
}

describe('buildEditClassifiedFact', () => {
  test('builds a w2 classification fact', () => {
    const fact = buildEditClassifiedFact(source, { sourceEventId: 'evt-1:edit_classified', window: 'w2' })
    expect(fact).toMatchObject({
      version: 1,
      type: 'edit_classified',
      sourceEventId: 'evt-1:edit_classified',
      window: 'w2',
      source,
    })
  })
})

describe('buildEditRegenFact', () => {
  test('omits durationMs when not provided', () => {
    const fact = buildEditRegenFact(source, { sourceEventId: 'evt-1:edit_regen_prompt_shown', phase: 'prompt_shown' })
    expect(fact).toMatchObject({ version: 1, type: 'edit_regen', phase: 'prompt_shown' })
    expect('durationMs' in fact).toBe(false)
  })

  test('carries durationMs when provided', () => {
    const fact = buildEditRegenFact(source, {
      sourceEventId: 'evt-1:edit_regen_regen_completed',
      phase: 'regen_completed',
      durationMs: 4200,
    })
    expect(fact).toMatchObject({ phase: 'regen_completed', durationMs: 4200 })
  })
})
