// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { taskInstanceLabel } from '../../../src/debug/settings/task-instance-options.js'

describe('taskInstanceLabel', () => {
  test('prefers the configured base URL', () => {
    expect(taskInstanceLabel('inst_abc', 'kaneo', 'https://kaneo.example')).toBe('https://kaneo.example')
  })

  test('falls back to a friendly type label plus the id when no base URL is configured', () => {
    expect(taskInstanceLabel('inst_bare', 'youtrack', undefined)).toBe('YouTrack instance (inst_bare)')
    expect(taskInstanceLabel('inst_k', 'kaneo', undefined)).toBe('Kaneo instance (inst_k)')
  })

  test('treats an empty base URL as absent rather than rendering a blank label', () => {
    expect(taskInstanceLabel('inst_bare', 'youtrack', '')).toBe('YouTrack instance (inst_bare)')
  })

  test('uses the raw type for provider types with no friendly name', () => {
    expect(taskInstanceLabel('inst_x', 'acme', undefined)).toBe('acme instance (inst_x)')
  })
})
