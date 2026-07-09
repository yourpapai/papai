// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { AdminCodingGuardrailsResponseSchema } from '../../../client/settings/fetcher-schemas-coding-guardrails.js'

describe('AdminCodingGuardrailsResponseSchema', () => {
  test('parses a default allow-all guardrails response', () => {
    const parsed = AdminCodingGuardrailsResponseSchema.parse({
      guardrails: { allowedAgents: ['claude', 'codex', 'opencode'], whoMayUse: 'members', forceSharedKey: false },
      sharedKeySet: false,
    })
    expect(parsed.guardrails.allowedAgents).toEqual(['claude', 'codex', 'opencode'])
    expect(parsed.guardrails.whoMayUse).toBe('members')
    expect(parsed.guardrails.forceSharedKey).toBe(false)
    expect(parsed.guardrails.maxMcpServers).toBe(3)
    expect(parsed.sharedKeySet).toBe(false)
  })

  test('parses a restricted guardrails response with allowlist and an explicit maxMcpServers', () => {
    const parsed = AdminCodingGuardrailsResponseSchema.parse({
      guardrails: {
        allowedAgents: ['claude'],
        whoMayUse: ['user-1', 'user-2'],
        forceSharedKey: true,
        maxMcpServers: 5,
      },
      sharedKeySet: true,
    })
    expect(parsed.guardrails.allowedAgents).toEqual(['claude'])
    expect(parsed.guardrails.whoMayUse).toEqual(['user-1', 'user-2'])
    expect(parsed.guardrails.forceSharedKey).toBe(true)
    expect(parsed.guardrails.maxMcpServers).toBe(5)
    expect(parsed.sharedKeySet).toBe(true)
  })

  test('rejects a maxMcpServers outside the 1-8 range', () => {
    expect(() =>
      AdminCodingGuardrailsResponseSchema.parse({
        guardrails: { allowedAgents: ['claude'], whoMayUse: 'members', forceSharedKey: false, maxMcpServers: 9 },
        sharedKeySet: false,
      }),
    ).toThrow()
  })

  test('throws when guardrails is missing', () => {
    expect(() => AdminCodingGuardrailsResponseSchema.parse({ sharedKeySet: false })).toThrow()
  })

  test('throws when sharedKeySet is missing', () => {
    expect(() =>
      AdminCodingGuardrailsResponseSchema.parse({
        guardrails: { allowedAgents: [], whoMayUse: 'members', forceSharedKey: false },
      }),
    ).toThrow()
  })
})
