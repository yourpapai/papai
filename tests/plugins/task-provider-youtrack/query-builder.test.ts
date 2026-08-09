// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildYouTrackQuery } from '../../../plugins/task-provider-youtrack/query-builder.js'

describe('buildYouTrackQuery', () => {
  test('emits only a lower due-date bound when dueAfter is set without dueBefore', () => {
    expect(buildYouTrackQuery({ dueAfter: '2026-01-01' }, 'DEMO')).toBe('project: {DEMO} Due date: >2026-01-01')
  })

  test('emits only an upper due-date bound when dueBefore is set without dueAfter', () => {
    expect(buildYouTrackQuery({ dueBefore: '2026-01-31' }, 'DEMO')).toBe('project: {DEMO} Due date: <2026-01-31')
  })

  test('rewrites a createdAt sort field to the YouTrack created field', () => {
    expect(buildYouTrackQuery({ sortBy: 'createdAt', sortOrder: 'desc' }, 'DEMO')).toBe(
      'project: {DEMO} sort by: created desc',
    )
  })

  test('defaults the sort order to asc when sortBy is set without sortOrder', () => {
    expect(buildYouTrackQuery({ sortBy: 'priority' }, 'DEMO')).toBe('project: {DEMO} sort by: priority asc')
  })
})
