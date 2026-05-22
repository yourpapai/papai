// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../../../src/providers/kaneo/client.js'
import { kaneoListLabels, kaneoListTaskLabels } from '../../../../src/providers/kaneo/operations/labels.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

describe('kaneo label operations', () => {
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

  describe('kaneoListLabels', () => {
    test('returns reusable workspace labels only', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'label-1', name: 'Feature', color: '#ff0000', taskId: null },
              { id: 'label-2', name: 'Feature', color: '#ff0000', taskId: 'task-1' },
              { id: 'label-3', name: 'archived', color: '#6b7280', taskId: null },
            ]),
            { status: 200 },
          ),
        ),
      )

      const result = await kaneoListLabels(mockConfig, 'workspace-1')

      expect(result).toEqual([
        { id: 'label-1', name: 'Feature', color: '#ff0000' },
        { id: 'label-3', name: 'archived', color: '#6b7280' },
      ])
    })
  })

  describe('kaneoListTaskLabels', () => {
    test('returns mapped task labels for the target task', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'task-label-1', name: 'Feature', color: '#ff0000', taskId: 'task-1' },
              { id: 'task-label-2', name: 'archived', color: '#6b7280', taskId: 'task-1' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const result = await kaneoListTaskLabels(mockConfig, 'task-1')

      expect(result).toEqual([
        { id: 'task-label-1', name: 'Feature', color: '#ff0000' },
        { id: 'task-label-2', name: 'archived', color: '#6b7280' },
      ])
    })
  })
})
