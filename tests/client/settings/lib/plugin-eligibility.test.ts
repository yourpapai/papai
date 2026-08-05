// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { PluginEntry } from '../../../../client/settings/fetcher-schemas.js'
import { eligibilityCopy } from '../../../../client/settings/lib/plugin-eligibility.js'

const plugin = (over: Partial<PluginEntry>): PluginEntry => ({
  id: 'p',
  name: 'P',
  active: true,
  enabled: false,
  eligibility: { eligible: true },
  contextConfig: [],
  ...over,
})

describe('eligibilityCopy', () => {
  test('an eligible plugin reads Ready with no explanation', () => {
    const copy = eligibilityCopy(plugin({ eligibility: { eligible: true } }))
    expect(copy).toEqual({ tone: 'accent', label: 'Ready' })
  })

  test('a context-disabled plugin reads Off with no explanation — the button already says Enable', () => {
    const copy = eligibilityCopy(plugin({ eligibility: { eligible: false, reason: 'disabled' } }))
    expect(copy).toEqual({ tone: 'mute', label: 'Off' })
  })

  test('an inactive plugin names operator approval as the gate', () => {
    const copy = eligibilityCopy(plugin({ eligibility: { eligible: false, reason: 'inactive' } }))
    expect(copy.tone).toBe('mute')
    expect(copy.label).toBe('Unavailable')
    expect(copy.explanation).toBe('An operator must approve this plugin before it can be enabled here.')
  })

  test('missing config names the fields by their labels, not their keys', () => {
    const copy = eligibilityCopy(
      plugin({
        eligibility: { eligible: false, reason: 'config_missing', missingKeys: ['api_key', 'workspace'] },
        contextConfig: [
          { key: 'api_key', label: 'API key', required: true, sensitive: true, hasValue: false, value: '' },
          { key: 'workspace', label: 'Workspace', required: true, sensitive: false, hasValue: false, value: '' },
        ],
      }),
    )
    expect(copy.tone).toBe('warn')
    expect(copy.label).toBe('Needs setup')
    expect(copy.explanation).toBe('Needs API key and Workspace before it can run.')
  })

  test('a missing key with no matching field falls back to the key itself', () => {
    const copy = eligibilityCopy(
      plugin({ eligibility: { eligible: false, reason: 'config_missing', missingKeys: ['ghost'] }, contextConfig: [] }),
    )
    expect(copy.explanation).toBe('Needs ghost before it can run.')
  })

  test('missing capabilities blame the assigned providers and quote the ids verbatim', () => {
    const copy = eligibilityCopy(
      plugin({
        eligibility: { eligible: false, reason: 'capability_missing', missingCapabilities: ['tasks.search'] },
      }),
    )
    expect(copy.tone).toBe('warn')
    expect(copy.label).toBe('Not supported here')
    expect(copy.explanation).toBe('The task or chat provider assigned to this context does not support tasks.search.')
  })

  test('three missing labels are joined with commas and a trailing "and"', () => {
    const copy = eligibilityCopy(
      plugin({
        eligibility: { eligible: false, reason: 'capability_missing', missingCapabilities: ['a', 'b', 'c'] },
      }),
    )
    expect(copy.explanation).toBe('The task or chat provider assigned to this context does not support a, b and c.')
  })
})
