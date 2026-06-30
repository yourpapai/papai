// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { HttpHandler } from 'msw'

import {
  codingIdentityHandlers,
  groupMembersHandlers,
  groupProviderHandlers,
  guestModeHandlers,
} from '../../../../client/stories/msw/settings-handlers-group.js'

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

describe('settings group msw handlers', () => {
  test('groupMembersHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(groupMembersHandlers.populated)).toBe(true)
    expect(Array.isArray(groupMembersHandlers.empty)).toBe(true)
    expect(Array.isArray(groupMembersHandlers.error)).toBe(true)
    expect(Array.isArray(groupMembersHandlers.loading)).toBe(true)
    expect(groupMembersHandlers.populated.length).toBeGreaterThan(0)
  })

  test('groupMembersHandlers populated covers /settings/api/group/members', () => {
    expect(pathsOf(groupMembersHandlers.populated).some((p) => p.includes('/settings/api/group/members'))).toBe(true)
  })

  test('guestModeHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(guestModeHandlers.populated)).toBe(true)
    expect(Array.isArray(guestModeHandlers.empty)).toBe(true)
    expect(Array.isArray(guestModeHandlers.error)).toBe(true)
    expect(Array.isArray(guestModeHandlers.loading)).toBe(true)
    expect(guestModeHandlers.populated.length).toBeGreaterThan(0)
  })

  test('guestModeHandlers populated covers /settings/api/group/guest-mode', () => {
    expect(pathsOf(guestModeHandlers.populated).some((p) => p.includes('/settings/api/group/guest-mode'))).toBe(true)
  })

  test('groupProviderHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(groupProviderHandlers.populated)).toBe(true)
    expect(Array.isArray(groupProviderHandlers.empty)).toBe(true)
    expect(Array.isArray(groupProviderHandlers.error)).toBe(true)
    expect(Array.isArray(groupProviderHandlers.loading)).toBe(true)
    expect(groupProviderHandlers.populated.length).toBeGreaterThan(0)
  })

  test('groupProviderHandlers populated covers /settings/api/group/task-instance', () => {
    expect(pathsOf(groupProviderHandlers.populated).some((p) => p.includes('/settings/api/group/task-instance'))).toBe(
      true,
    )
  })

  test('codingIdentityHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(codingIdentityHandlers.populated)).toBe(true)
    expect(Array.isArray(codingIdentityHandlers.empty)).toBe(true)
    expect(Array.isArray(codingIdentityHandlers.error)).toBe(true)
    expect(Array.isArray(codingIdentityHandlers.loading)).toBe(true)
    expect(codingIdentityHandlers.populated.length).toBeGreaterThan(0)
  })

  test('codingIdentityHandlers populated covers /settings/api/group/coding-identity', () => {
    expect(
      pathsOf(codingIdentityHandlers.populated).some((p) => p.includes('/settings/api/group/coding-identity')),
    ).toBe(true)
  })
})
