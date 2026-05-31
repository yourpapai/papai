// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  buildCreateCustomFields,
  buildYouTrackQuery,
  mapYouTrackDueDateValue,
} from '../../../plugins/task-provider-youtrack/task-helpers.js'

describe('task-helpers', () => {
  test('maps YouTrack due date timestamps to date-only values', () => {
    expect(mapYouTrackDueDateValue(Date.parse('2026-03-25T12:00:00.000Z'))).toBe('2026-03-25')
    expect(mapYouTrackDueDateValue(undefined)).toBeUndefined()
  })

  test('builds YouTrack list query with exclusive due date filters and sort', () => {
    expect(
      buildYouTrackQuery(
        {
          status: 'Open',
          priority: 'urgent',
          assigneeId: 'jane.doe',
          dueAfter: '2026-03-01',
          dueBefore: '2026-03-31',
          sortBy: 'priority',
          sortOrder: 'desc',
        },
        'DEMO',
      ),
    ).toBe(
      'project: {DEMO} State: {Open} Priority: {urgent} Assignee: {jane.doe} Due date: >2026-03-01 Due date: <2026-03-31 sort by: priority desc',
    )
  })

  test('adds supported create-time custom fields alongside standard fields', () => {
    const projectCustomFields = [
      {
        id: '82-13',
        $type: 'TextProjectCustomField',
        field: {
          id: '58-5',
          name: 'Environment details',
          $type: 'CustomField',
          fieldType: { id: 'text', presentation: 'text' },
        },
        canBeEmpty: true,
        isPublic: true,
      },
    ] as const

    expect(
      buildCreateCustomFields(
        {
          priority: 'High',
          customFields: [{ name: 'Environment details', value: 'Needs staging parity' }],
        },
        projectCustomFields,
      ),
    ).toEqual([
      {
        name: 'Priority',
        $type: 'SingleEnumIssueCustomField',
        value: { name: 'High' },
      },
      {
        name: 'Environment details',
        $type: 'TextIssueCustomField',
        value: { text: 'Needs staging parity' },
      },
    ])
  })
})
