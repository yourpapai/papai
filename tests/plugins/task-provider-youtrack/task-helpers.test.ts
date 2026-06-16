// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  buildIssueCustomFields,
  buildYouTrackQuery,
  mapYouTrackDueDateValue,
  validateRequiredCreateFields,
} from '../../../plugins/task-provider-youtrack/task-helpers.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'
import { createUniqueYouTrackConfig } from './fetch-mock-utils.js'

const queueResponses = (responses: readonly unknown[]): void => {
  let i = 0
  setMockFetch(() => {
    const body = responses[Math.min(i, responses.length - 1)]
    i += 1
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  })
}

describe('validateRequiredCreateFields', () => {
  beforeEach(() => mockLogger())
  afterEach(() => restoreFetch())

  test('does not flag a required field that has a default value', async () => {
    const config = createUniqueYouTrackConfig()
    queueResponses([
      [
        {
          $type: 'StateProjectCustomField',
          field: { name: 'State', fieldType: { id: 'state[1]' } },
          canBeEmpty: false,
          defaultValues: [{ name: 'Open' }],
          bundle: { id: 'sb-1', $type: 'StateBundle' },
        },
      ],
    ])
    const fields = await validateRequiredCreateFields(config, '0-1', 'TEST', {})
    expect(fields).toHaveLength(1)
  })

  test('teaching error lists allowed values for a required state field', async () => {
    const config = createUniqueYouTrackConfig()
    queueResponses([
      [
        {
          $type: 'StateProjectCustomField',
          field: { name: 'State', fieldType: { id: 'state[1]' } },
          canBeEmpty: false,
          bundle: { id: 'sb-1', $type: 'StateBundle' },
        },
      ],
      [{ name: 'Open' }, { name: 'In Progress', localizedName: 'В работе' }],
    ])
    await expect(validateRequiredCreateFields(config, '0-1', 'TEST', {})).rejects.toThrow(
      /requires these custom fields.*State.*Open, In Progress/u,
    )
  })
})

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

  test('builds a generic text custom field through the field engine', async () => {
    const config = createUniqueYouTrackConfig()
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

    const result = await buildIssueCustomFields(
      config,
      { customFields: [{ name: 'Environment details', value: 'Needs staging parity' }] },
      projectCustomFields,
      'create',
    )

    expect(result).toContainEqual({
      name: 'Environment details',
      $type: 'TextIssueCustomField',
      value: { text: 'Needs staging parity' },
    })
  })
})

describe('buildIssueCustomFields', () => {
  test('resolves a dedicated status to the localized state field via the engine', async () => {
    const config = createUniqueYouTrackConfig()
    const projectCustomFields = [
      {
        $type: 'StateProjectCustomField',
        field: { name: 'Cтaтус', fieldType: { id: 'state[1]' } },
        canBeEmpty: false,
        bundle: { id: 'sb-1', $type: 'StateBundle' },
      },
    ] as const
    // resolveCustomFieldValue fetches the state bundle values once.
    queueResponses([[{ name: 'Не разобрана' }, { name: 'Open' }]])

    const result = await buildIssueCustomFields(config, { status: 'Open' }, projectCustomFields, 'create')

    expect(result).toContainEqual({ name: 'Cтaтус', $type: 'StateIssueCustomField', value: { name: 'Open' } })
  })
})
