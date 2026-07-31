// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildDerivedFamilyProps } from '../../src/analytics/normalizer-props-derived.js'
import { createFactKeyDeriver } from '../../src/analytics/normalizer-shared.js'
import type { ValidatedFactRecord } from '../../src/analytics/normalizer-shared.js'
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

const factRecord = (extra: Readonly<Record<string, unknown>>): ValidatedFactRecord => {
  const { type, ...rest } = extra
  if (typeof type !== 'string') throw new Error('factRecord requires a string `type`')
  return {
    version: 1,
    type,
    sourceEventId: 'se-derived-1',
    occurredAtMs: 1_700_000_002_700,
    source,
    ...rest,
  }
}

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

  test('edit_classified normalizes a valid window', () => {
    const result = buildDerivedFamilyProps(factRecord({ type: 'edit_classified', window: 'w2' }), keys)
    expect(result).toEqual({ ok: true, props: { window: 'w2' } })
  })

  test('edit_classified rejects an unknown window', () => {
    const result = buildDerivedFamilyProps(factRecord({ type: 'edit_classified', window: 'w4' }), keys)
    expect(result).toEqual({ ok: false, reason: 'unknown_enum' })
  })

  test('edit_regen normalizes a phase without duration', () => {
    const result = buildDerivedFamilyProps(factRecord({ type: 'edit_regen', phase: 'prompt_shown' }), keys)
    expect(result).toEqual({ ok: true, props: { phase: 'prompt_shown' } })
  })

  test('edit_regen normalizes a completed phase with duration', () => {
    const result = buildDerivedFamilyProps(
      factRecord({ type: 'edit_regen', phase: 'regen_completed', durationMs: 4200 }),
      keys,
    )
    expect(result).toEqual({ ok: true, props: { phase: 'regen_completed', duration_ms: 4200 } })
  })

  test('edit_regen rejects an unknown phase and a negative duration', () => {
    expect(buildDerivedFamilyProps(factRecord({ type: 'edit_regen', phase: 'regen_vibes' }), keys)).toEqual({
      ok: false,
      reason: 'unknown_enum',
    })
    expect(
      buildDerivedFamilyProps(factRecord({ type: 'edit_regen', phase: 'regen_failed', durationMs: -1 }), keys),
    ).toEqual({ ok: false, reason: 'invalid_value' })
  })
})
