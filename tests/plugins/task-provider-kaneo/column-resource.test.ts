// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../../plugins/task-provider-kaneo/client.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'
import { ColumnResource } from './test-resources.js'

describe('ColumnResource', () => {
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

  describe('list', () => {
    test('returns all columns for project', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'col-1', name: 'Todo', icon: null, color: null, isFinal: false },
              { id: 'col-2', name: 'In Progress', icon: null, color: null, isFinal: false },
              { id: 'col-3', name: 'Done', icon: 'Check', color: '#00ff00', isFinal: true },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new ColumnResource(mockConfig)
      const result = await resource.list('proj-1')

      expect(result).toHaveLength(3)
      expect(result[0]?.name).toBe('Todo')
      expect(result[1]?.name).toBe('In Progress')
      expect(result[2]?.name).toBe('Done')
    })

    test('returns columns with correct properties', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'col-3', name: 'Done', icon: 'Check', color: '#00ff00', isFinal: true },
              { id: 'col-1', name: 'Todo', icon: null, color: null, isFinal: false },
              { id: 'col-2', name: 'In Progress', icon: null, color: null, isFinal: false },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new ColumnResource(mockConfig)
      const result = await resource.list('proj-1')

      // Verify columns maintain their structure
      expect(result).toHaveLength(3)
      const col1 = result.find((c) => c.id === 'col-1')
      const col2 = result.find((c) => c.id === 'col-2')
      const col3 = result.find((c) => c.id === 'col-3')
      expect(col1?.isFinal).toBe(false)
      expect(col2?.isFinal).toBe(false)
      expect(col3?.isFinal).toBe(true)
      expect(col1?.color).toBeNull()
      expect(col3?.color).toBe('#00ff00')
    })

    test('returns empty array when no columns', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))

      const resource = new ColumnResource(mockConfig)
      const result = await resource.list('proj-1')

      expect(result).toHaveLength(0)
    })

    test('uses correct API endpoint', async () => {
      let requestUrl: string | undefined
      setMockFetch((url: string) => {
        requestUrl = url
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      })

      const resource = new ColumnResource(mockConfig)
      await resource.list('proj-1')

      expect(requestUrl).toContain('/column/proj-1')
    })

    test('throws for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })))

      const resource = new ColumnResource(mockConfig)
      const promise = resource.list('invalid')
      await expect(promise).rejects.toBeInstanceOf(Error)
    })

    test('throws on API error', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })))

      const resource = new ColumnResource(mockConfig)
      const promise = resource.list('proj-1')
      await expect(promise).rejects.toThrow()
    })

    test('throws on server error', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })))

      const resource = new ColumnResource(mockConfig)
      const promise = resource.list('proj-1')
      await expect(promise).rejects.toThrow()
    })
  })
})
