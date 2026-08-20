// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatTaskInstanceOption } from '../../../../client/settings/lib/task-instance-label.js'

describe('formatTaskInstanceOption', () => {
  test('uses the server-supplied name', () => {
    expect(
      formatTaskInstanceOption({ id: 'inst_abc', type: 'kaneo', status: 'active', name: 'https://kaneo.example' }),
    ).toEqual({ value: 'inst_abc', label: 'https://kaneo.example (kaneo · active)' })
  })

  test('falls back to a friendly type label plus the id when the name is absent', () => {
    expect(formatTaskInstanceOption({ id: 'inst_bare', type: 'youtrack', status: 'active' })).toEqual({
      value: 'inst_bare',
      label: 'YouTrack instance (inst_bare) (youtrack · active)',
    })
  })

  test('treats an empty name as absent rather than rendering a blank label', () => {
    expect(formatTaskInstanceOption({ id: 'inst_bare', type: 'kaneo', status: 'active', name: '' }).label).toBe(
      'Kaneo instance (inst_bare) (kaneo · active)',
    )
  })

  test('uses the raw type for provider types with no friendly name', () => {
    expect(formatTaskInstanceOption({ id: 'inst_x', type: 'acme', status: 'active' }).label).toBe(
      'acme instance (inst_x) (acme · active)',
    )
  })
})
