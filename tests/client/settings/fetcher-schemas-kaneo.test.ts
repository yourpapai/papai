// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { KaneoCredentialsSchema, KaneoRevealSchema } from '../../../client/settings/fetcher-schemas-kaneo.js'

describe('KaneoCredentialsSchema', () => {
  test('parses a valid credentials response', () => {
    const result = KaneoCredentialsSchema.parse({
      contextId: 'grp-1',
      login: 'user@pap.ai',
      status: 'active',
      kaneoUrl: 'http://kaneo.example.com',
    })
    expect(result.login).toBe('user@pap.ai')
    expect(result.status).toBe('active')
  })

  test('parses with null kaneoUrl', () => {
    const result = KaneoCredentialsSchema.parse({
      contextId: 'grp-1',
      login: 'user@pap.ai',
      status: 'active',
      kaneoUrl: null,
    })
    expect(result.kaneoUrl).toBeNull()
  })

  test('rejects unknown status values', () => {
    expect(() =>
      KaneoCredentialsSchema.parse({ contextId: 'g', login: 'x@pap.ai', status: 'unknown', kaneoUrl: null }),
    ).toThrow()
  })
})

describe('KaneoRevealSchema', () => {
  test('parses a valid reveal response', () => {
    const result = KaneoRevealSchema.parse({
      password: 'S3cr3tP@ss',
      warning: 'This password is shown once. Store it securely.',
    })
    expect(result.password).toBe('S3cr3tP@ss')
  })
})
