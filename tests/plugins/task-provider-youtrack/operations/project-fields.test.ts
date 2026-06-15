// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { describeYouTrackProjectFields } from '../../../../plugins/task-provider-youtrack/operations/project-fields.js'
import { mockLogger, restoreFetch } from '../../../utils/test-helpers.js'
import { createUniqueYouTrackConfig, mockFetchSequence } from '../fetch-mock-utils.js'

const fetchMockRef: { current?: ReturnType<typeof import('bun:test').mock<() => Promise<Response>>> } = {}

describe('describeYouTrackProjectFields', () => {
  beforeEach(() => mockLogger())
  afterEach(() => restoreFetch())

  test('describes a required state field with allowed values', async () => {
    const config = createUniqueYouTrackConfig()
    mockFetchSequence(fetchMockRef, [
      {
        data: [
          {
            $type: 'StateProjectCustomField',
            field: { name: 'State', fieldType: { id: 'state[1]' } },
            canBeEmpty: false,
            bundle: { id: 'sb-1', $type: 'StateBundle' },
          },
        ],
      },
      {
        data: [{ name: 'Open' }, { name: 'In Progress', localizedName: 'В работе' }],
      },
    ])

    const fields = await describeYouTrackProjectFields(config, '0-1')

    expect(fields).toEqual([
      {
        name: 'State',
        type: 'state',
        multi: false,
        required: true,
        defaultValue: undefined,
        allowedValues: ['Open', 'In Progress'],
      },
    ])
  })
})
