// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  kaneoCreateStatus,
  kaneoDeleteStatus,
  kaneoListStatuses,
  kaneoReorderStatuses,
  kaneoUpdateStatus,
} from '../../../../src/providers/kaneo/operations/statuses.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

describe('kaneo statuses operations', () => {
  const mockConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }

  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('kaneoListStatuses', () => {
    test('returns mapped columns', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'col-1', name: 'Todo', icon: null, color: null, isFinal: false },
              { id: 'col-2', name: 'Done', icon: 'Check', color: '#00ff00', isFinal: true },
            ]),
            { status: 200 },
          ),
        ),
      )
      const result = await kaneoListStatuses(mockConfig, 'proj-1')
      expect(result).toHaveLength(2)
      expect(result[0]?.name).toBe('Todo')
      expect(result[1]?.name).toBe('Done')
      expect(result[1]?.isFinal).toBe(true)
    })

    test('returns empty array when no columns', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))
      const result = await kaneoListStatuses(mockConfig, 'proj-1')
      expect(result).toHaveLength(0)
    })
  })

  describe('kaneoCreateStatus', () => {
    test('creates and returns column', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 'col-1', name: 'Done', icon: 'Check', color: '#00ff00', isFinal: true }), {
            status: 200,
          }),
        ),
      )
      const result = await kaneoCreateStatus(mockConfig, 'proj-1', { name: 'Done', isFinal: true })
      expect(result.name).toBe('Done')
      expect(result.isFinal).toBe(true)
    })
  })

  describe('kaneoUpdateStatus', () => {
    test('updates and returns column', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 'col-1', name: 'Updated', icon: null, color: null, isFinal: false }), {
            status: 200,
          }),
        ),
      )
      const result = await kaneoUpdateStatus(mockConfig, 'col-1', { name: 'Updated' })
      expect(result.name).toBe('Updated')
    })
  })

  describe('kaneoDeleteStatus', () => {
    test('deletes and returns id', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ id: 'col-1' }), { status: 200 })))
      const result = await kaneoDeleteStatus(mockConfig, 'col-1')
      expect(result.id).toBe('col-1')
    })
  })

  describe('kaneoReorderStatuses', () => {
    test('returns undefined after reordering', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))
      const result = await kaneoReorderStatuses(mockConfig, 'proj-1', [{ id: 'col-1', position: 0 }])
      expect(result).toBeUndefined()
    })
  })
})
