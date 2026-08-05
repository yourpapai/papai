// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { HttpHandler } from 'msw'

import { taskProviderBoundHandlers } from '../../../../client/stories/msw/settings-handlers-task-provider.js'

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

describe('settings task-provider msw handlers', () => {
  test('taskProviderBoundHandlers is a non-empty array covering config, context/task-instance and provision/kaneo', () => {
    expect(Array.isArray(taskProviderBoundHandlers)).toBe(true)
    expect(taskProviderBoundHandlers.length).toBeGreaterThan(0)
    const paths = pathsOf(taskProviderBoundHandlers)
    expect(paths.some((p) => p.includes('/settings/api/config'))).toBe(true)
    expect(paths.some((p) => p.includes('/settings/api/context/task-instance'))).toBe(true)
    expect(paths.some((p) => p.includes('/settings/api/provision/kaneo'))).toBe(true)
  })
})
