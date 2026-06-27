// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setCachedConfig } from '../../src/cache.js'
import {
  adminCodingGuardrailsContextId,
  resolveCodingGuardrails,
  setCodingGuardrails,
} from '../../src/coding-credentials/guardrails.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('guardrails', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('resolveCodingGuardrails defaults to allow-all when unset', () => {
    const g = resolveCodingGuardrails('pi-1')
    expect(g.whoMayUse).toBe('members')
    expect(g.forceSharedKey).toBe(false)
    expect(g.allowedAgents).toEqual(['claude', 'codex', 'opencode'])
  })

  test('setCodingGuardrails round-trips', () => {
    setCodingGuardrails('pi-1', { allowedAgents: ['claude'], whoMayUse: ['u1'], forceSharedKey: true })
    const g = resolveCodingGuardrails('pi-1')
    expect(g.allowedAgents).toEqual(['claude'])
    expect(g.whoMayUse).toEqual(['u1'])
    expect(g.forceSharedKey).toBe(true)
    expect(adminCodingGuardrailsContextId('pi-1')).toBe('__admin_coding_guardrails__:pi-1')
  })

  test('resolveCodingGuardrails falls back to defaults on parse error', () => {
    setCachedConfig('__admin_coding_guardrails__:pi-1', 'coding_guardrails', 'not-json')
    const g = resolveCodingGuardrails('pi-1')
    expect(g.allowedAgents).toEqual(['claude', 'codex', 'opencode'])
    expect(g.whoMayUse).toBe('members')
  })
})
