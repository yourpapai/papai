// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { isNamespace } from '../../../../client/stories/msw/namespace.js'

const request = (namespace: string): Request =>
  new Request(`http://localhost/settings/api/coding-credentials?namespace=${namespace}`)

describe('isNamespace', () => {
  test('returns true when the request namespace matches', () => {
    expect(isNamespace(request('agent-provider'), 'agent-provider')).toBe(true)
  })

  test('returns false when the request namespace differs', () => {
    expect(isNamespace(request('forge'), 'agent-provider')).toBe(false)
  })

  test('returns false when the request has no namespace param', () => {
    expect(isNamespace(new Request('http://localhost/settings/api/coding-credentials'), 'agent-provider')).toBe(false)
  })
})
