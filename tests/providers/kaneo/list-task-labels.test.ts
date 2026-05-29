// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../../plugins/task-provider-kaneo/client.js'
import { listTaskLabels } from '../../../plugins/task-provider-kaneo/list-task-labels.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

function getRequestMethod(options: RequestInit): string {
  return options.method ?? 'GET'
}

describe('listTaskLabels', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  afterEach(() => {
    restoreFetch()
  })

  test('requests task labels from the Kaneo task labels endpoint', async () => {
    const requests: Array<{ url: string; method: string }> = []
    setMockFetch((url, options) => {
      requests.push({ url, method: getRequestMethod(options) })
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { id: 'task-label-1', name: 'Feature', color: '#ff0000', taskId: 'task-1' },
            { id: 'task-label-2', name: 'archived', color: '#6b7280', taskId: 'task-1' },
          ]),
          { status: 200 },
        ),
      )
    })

    const result = await listTaskLabels({ config: mockConfig, taskId: 'task-1' })

    expect(requests).toEqual([
      {
        url: 'https://api.test.com/api/label/task/task-1',
        method: 'GET',
      },
    ])
    expect(result).toEqual([
      { id: 'task-label-1', name: 'Feature', color: '#ff0000', taskId: 'task-1' },
      { id: 'task-label-2', name: 'archived', color: '#6b7280', taskId: 'task-1' },
    ])
  })
})
