// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeListSavedQueriesTool } from '../../src/tools/list-saved-queries.js'
import { makeRunSavedQueryTool } from '../../src/tools/run-saved-query.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('Saved query tools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('list_saved_queries returns saved queries', async () => {
    const listSavedQueries = mock(() => Promise.resolve([{ id: 'query-1', name: 'Open Issues', query: 'State: Open' }]))
    const result = await getToolExecutor(makeListSavedQueriesTool(createMockProvider({ listSavedQueries })))({})
    expect(result).toEqual([{ id: 'query-1', name: 'Open Issues', query: 'State: Open' }])
    expect(listSavedQueries).toHaveBeenCalledTimes(1)
  })

  test('run_saved_query requires queryId', () => {
    const tool = makeRunSavedQueryTool(createMockProvider())
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { queryId: 'query-1' })).toBe(true)
  })

  test('run_saved_query forwards queryId and returns search results', async () => {
    const runSavedQuery = mock(() =>
      Promise.resolve([{ id: 'TEST-1', title: 'Bug fix', status: 'Open', url: 'https://test.com/task/1' }]),
    )
    const result = await getToolExecutor(makeRunSavedQueryTool(createMockProvider({ runSavedQuery })))({
      queryId: 'query-1',
    })
    expect(result).toEqual([{ id: 'TEST-1', title: 'Bug fix', status: 'Open', url: 'https://test.com/task/1' }])
    expect(runSavedQuery).toHaveBeenCalledWith('query-1')
  })
})
