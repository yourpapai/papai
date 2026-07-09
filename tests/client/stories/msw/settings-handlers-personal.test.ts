// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { HttpHandler } from 'msw'

import {
  codingCredentialsHandlers,
  identityHandlers,
  mcpHandlers,
  memoryHandlers,
  pluginsHandlers,
} from '../../../../client/stories/msw/settings-handlers-personal.js'

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

describe('personal settings msw handlers', () => {
  // --- codingCredentialsHandlers ---

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

  // --- memoryHandlers ---

  test('memoryHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(memoryHandlers.populated)).toBe(true)
    expect(Array.isArray(memoryHandlers.empty)).toBe(true)
    expect(Array.isArray(memoryHandlers.error)).toBe(true)
    expect(Array.isArray(memoryHandlers.loading)).toBe(true)
    expect(memoryHandlers.populated.length).toBeGreaterThan(0)
  })

  test('memoryHandlers populated covers /settings/api/memory', () => {
    expect(pathsOf(memoryHandlers.populated).some((p) => p.includes('/settings/api/memory'))).toBe(true)
  })

  // --- mcpHandlers ---

  test('mcpHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(mcpHandlers.populated)).toBe(true)
    expect(Array.isArray(mcpHandlers.empty)).toBe(true)
    expect(Array.isArray(mcpHandlers.error)).toBe(true)
    expect(Array.isArray(mcpHandlers.loading)).toBe(true)
    expect(mcpHandlers.populated.length).toBeGreaterThan(0)
  })

  test('mcpHandlers populated covers /settings/api/mcp', () => {
    expect(pathsOf(mcpHandlers.populated).some((p) => p.includes('/settings/api/mcp'))).toBe(true)
  })

  // --- pluginsHandlers ---

  test('pluginsHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(pluginsHandlers.populated)).toBe(true)
    expect(Array.isArray(pluginsHandlers.empty)).toBe(true)
    expect(Array.isArray(pluginsHandlers.error)).toBe(true)
    expect(Array.isArray(pluginsHandlers.loading)).toBe(true)
    expect(pluginsHandlers.populated.length).toBeGreaterThan(0)
  })

  test('pluginsHandlers populated covers /settings/api/plugins', () => {
    expect(pathsOf(pluginsHandlers.populated).some((p) => p.includes('/settings/api/plugins'))).toBe(true)
  })

  // --- identityHandlers ---

  test('identityHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(identityHandlers.populated)).toBe(true)
    expect(Array.isArray(identityHandlers.empty)).toBe(true)
    expect(Array.isArray(identityHandlers.error)).toBe(true)
    expect(Array.isArray(identityHandlers.loading)).toBe(true)
    expect(identityHandlers.populated.length).toBeGreaterThan(0)
  })

  test('identityHandlers populated covers /settings/api/identity', () => {
    expect(pathsOf(identityHandlers.populated).some((p) => p.includes('/settings/api/identity'))).toBe(true)
  })
})
