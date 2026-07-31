// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { HttpHandler } from 'msw'

import { codingCredentialsHandlers } from '../../../../client/stories/msw/settings-handlers-coding.js'

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

describe('coding settings msw handlers', () => {
  test('codingCredentialsHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(codingCredentialsHandlers.populated)).toBe(true)
    expect(Array.isArray(codingCredentialsHandlers.empty)).toBe(true)
    expect(Array.isArray(codingCredentialsHandlers.error)).toBe(true)
    expect(Array.isArray(codingCredentialsHandlers.loading)).toBe(true)
    expect(codingCredentialsHandlers.populated.length).toBeGreaterThan(0)
  })

  test('codingCredentialsHandlers populated covers /settings/api/coding-credentials', () => {
    expect(
      pathsOf(codingCredentialsHandlers.populated).some((p) => p.includes('/settings/api/coding-credentials')),
    ).toBe(true)
  })

  test('codingCredentialsHandlers populated wires the models endpoint', () => {
    expect(
      pathsOf(codingCredentialsHandlers.populated).some((p) => p.includes('/settings/api/coding-credentials/models')),
    ).toBe(true)
  })
})
