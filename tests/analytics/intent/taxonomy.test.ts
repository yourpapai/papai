// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import * as pocTaxonomy from '../../../docs/research/analytics-metrics/poc/intent/taxonomy.js'
import {
  CORE_INTENTS,
  INTENT_IDS,
  INTENT_LABELS,
  isCoreIntent,
  isIntentGoal,
  isIntentLabel,
  sortGoals,
  TAXONOMY_VERSION,
} from '../../../src/analytics/intent/taxonomy.js'

describe('runtime intent.v1 taxonomy parity with the frozen PoC module', () => {
  test('core intents preserve label strings and order exactly', () => {
    expect(CORE_INTENTS).toEqual(pocTaxonomy.CORE_INTENTS)
    expect(CORE_INTENTS).toHaveLength(20)
  })

  test('full label list preserves label strings and sort order exactly', () => {
    expect(INTENT_LABELS).toEqual(pocTaxonomy.INTENT_LABELS)
    expect(INTENT_LABELS).toHaveLength(23)
  })

  test('intent ids match the frozen I01-I23 mapping', () => {
    expect(INTENT_IDS).toEqual(pocTaxonomy.INTENT_IDS)
    expect(INTENT_IDS['task.create']).toBe('I01')
    expect(INTENT_IDS.help_context).toBe('I20')
    expect(INTENT_IDS.no_action).toBe('I21')
    expect(INTENT_IDS.unknown).toBe('I22')
    expect(INTENT_IDS.multi_goal).toBe('I23')
  })

  test('taxonomy version is intent.v1', () => {
    expect(TAXONOMY_VERSION).toBe('intent.v1')
    expect(TAXONOMY_VERSION).toBe(pocTaxonomy.TAXONOMY_VERSION)
  })

  test('goal sorting is deduplicated and taxonomy-ordered like the PoC', () => {
    const goals = ['help_context', 'task.create', 'web.retrieve', 'task.create'] as const
    expect(sortGoals(goals)).toEqual(pocTaxonomy.sortGoals(goals))
    expect(sortGoals(goals)).toEqual(['task.create', 'web.retrieve', 'help_context'])
    expect(sortGoals(['no_action', 'task.delete'])).toEqual(['task.delete', 'no_action'])
  })

  test('type guards mirror the PoC semantics', () => {
    expect(isCoreIntent('task.create')).toBe(true)
    expect(isCoreIntent('no_action')).toBe(false)
    expect(isIntentLabel('multi_goal')).toBe(true)
    expect(isIntentLabel('not_a_label')).toBe(false)
    expect(isIntentGoal('no_action')).toBe(true)
    expect(isIntentGoal('unknown')).toBe(false)
  })
})
