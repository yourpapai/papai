// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { KaneoClassifiedError } from '../../../plugins/task-provider-kaneo/classify-error.js'
import type { KaneoConfig } from '../../../plugins/task-provider-kaneo/client.js'
import type { TaskStatusDeps } from '../../../plugins/task-provider-kaneo/task-status.js'
import { denormalizeStatus, validateStatus } from '../../../plugins/task-provider-kaneo/task-status.js'
import { getUserMessage } from '../../../src/errors.js'
import { mockLogger } from '../../utils/test-helpers.js'

type ColumnEntry = { id: string; name: string; order: number }

const defaultColumns: ColumnEntry[] = [
  { id: 'col-1', name: 'To Do', order: 0 },
  { id: 'col-2', name: 'In Progress', order: 1 },
  { id: 'col-3', name: 'Done', order: 2 },
]

const mockConfig: KaneoConfig = { apiKey: 'test-key', baseUrl: 'https://test.kaneo.app' }

function columnsReturning(columns: ColumnEntry[]): TaskStatusDeps {
  return { listColumns: (): Promise<ColumnEntry[]> => Promise.resolve(columns) }
}

describe('validateStatus', () => {
  let deps: TaskStatusDeps

  beforeEach(() => {
    mockLogger()
    deps = columnsReturning(defaultColumns)
  })

  describe('with valid status names', () => {
    test('resolves with slug for exact column name match', async () => {
      const result = await validateStatus(mockConfig, 'proj-1', 'To Do', deps)
      expect(result).toBe('to-do')
    })

    test('resolves with slug for case-insensitive match', async () => {
      const result = await validateStatus(mockConfig, 'proj-1', 'to do', deps)
      expect(result).toBe('to-do')
    })

    test('resolves with slug for hyphenated input', async () => {
      const result = await validateStatus(mockConfig, 'proj-1', 'in-progress', deps)
      expect(result).toBe('in-progress')
    })

    test('collapses runs of whitespace in the input into a single hyphen', async () => {
      const result = await validateStatus(mockConfig, 'proj-1', 'To  Do', deps)
      expect(result).toBe('to-do')
    })
  })

  describe('with partial (prefixed) status names', () => {
    test('resolves a status that prefixes a column slug', async () => {
      const result = await validateStatus(mockConfig, 'proj-1', 'to', deps)
      expect(result).toBe('to')
    })

    test('resolves a multi-segment status that prefixes a column slug', async () => {
      const partialDeps = columnsReturning([{ id: 'col-x', name: 'To Do Extra', order: 0 }])
      const result = await validateStatus(mockConfig, 'proj-1', 'to-do', partialDeps)
      expect(result).toBe('to-do')
    })
  })

  describe('with columns whose slugs are not clean slug patterns', () => {
    test('matches a multi-space special-character column via the first loop', async () => {
      const specialDeps = columnsReturning([{ id: 'col-s', name: 'In  Review?', order: 0 }])
      const result = await validateStatus(mockConfig, 'proj-1', 'in-review?', specialDeps)
      expect(result).toBe('in-review?')
    })

    test('rejects a prefix that shares characters but not the dash boundary', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'to', columnsReturning([{ id: 'c', name: 'Today', order: 0 }]))
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(KaneoClassifiedError)
    })

    test('rejects a non-slug status whose column only matches when the pattern gate is bypassed', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'to!', columnsReturning([{ id: 'c', name: 'To! Do', order: 0 }]))
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(KaneoClassifiedError)
    })

    test('rejects a status with a non-slug prefix even when a column slug embeds it', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', '##to', columnsReturning([{ id: 'c', name: '##To Do', order: 0 }]))
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(KaneoClassifiedError)
    })

    test('rejects a status with a non-slug suffix even when a column slug embeds it', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'to##', columnsReturning([{ id: 'c', name: 'To## Do', order: 0 }]))
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(KaneoClassifiedError)
    })
  })

  describe('with invalid status names', () => {
    test('throws KaneoClassifiedError with status-not-found code', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'Review', deps)
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(KaneoClassifiedError)
      assert(thrownError instanceof KaneoClassifiedError)
      expect(thrownError.appError.code).toBe('status-not-found')
    })

    test('error message is the exact classified text', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'Review', deps)
      } catch (error) {
        thrownError = error
      }
      assert(thrownError instanceof KaneoClassifiedError)
      expect(thrownError.message).toBe('Invalid status "Review". Must match one of: To Do, In Progress, Done')
    })

    test('error includes invalid status name', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'InvalidStatus', deps)
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(Error)
      assert(thrownError instanceof Error)
      expect(thrownError.message).toBe('Invalid status "InvalidStatus". Must match one of: To Do, In Progress, Done')
    })

    test('error includes available statuses in payload', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'NonExistent', deps)
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(KaneoClassifiedError)
      assert(thrownError instanceof KaneoClassifiedError)
      const appError = thrownError.appError
      expect(appError.code).toBe('status-not-found')
      const message = getUserMessage(appError)
      expect(message).toBe('Status "NonExistent" is not recognised. Available statuses: To Do, In Progress, Done.')
    })
  })

  describe('with custom project columns', () => {
    test('validates against custom project columns', async () => {
      const customDeps = columnsReturning([
        { id: 'col-x', name: 'Backlog', order: 0 },
        { id: 'col-y', name: 'Shipped', order: 1 },
      ])
      const result = await validateStatus(mockConfig, 'proj-1', 'Backlog', customDeps)
      expect(result).toBe('backlog')
    })
  })

  describe('error message format', () => {
    test('provides user-friendly message via getUserMessage', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'Review', deps)
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(KaneoClassifiedError)
      assert(thrownError instanceof KaneoClassifiedError)
      const message = getUserMessage(thrownError.appError)
      expect(message).toBe('Status "Review" is not recognised. Available statuses: To Do, In Progress, Done.')
    })
  })
})

describe('denormalizeStatus', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns the canonical slug for an exact column match', async () => {
    const result = await denormalizeStatus(mockConfig, 'proj-1', 'done', columnsReturning(defaultColumns))
    expect(result).toBe('done')
  })

  test('returns the canonical slug for a compound status on a non-first column', async () => {
    const result = await denormalizeStatus(mockConfig, 'proj-1', 'in-progress-2', columnsReturning(defaultColumns))
    expect(result).toBe('in-progress')
  })

  test('collapses multi-space column names when matching a compound status', async () => {
    const multiSpaceDeps = columnsReturning([{ id: 'col-m', name: 'To  Do', order: 0 }])
    const result = await denormalizeStatus(mockConfig, 'proj-1', 'to-do-9', multiSpaceDeps)
    expect(result).toBe('to-do')
  })

  test('prefers an exact match over a later prefix match', async () => {
    const orderedDeps = columnsReturning([
      { id: 'col-a', name: 'To Do', order: 0 },
      { id: 'col-b', name: 'To', order: 1 },
    ])
    const result = await denormalizeStatus(mockConfig, 'proj-1', 'to-do', orderedDeps)
    expect(result).toBe('to-do')
  })

  test('does not treat a no-dash prefix as a match', async () => {
    const prefixDeps = columnsReturning([
      { id: 'col-a', name: 'In', order: 0 },
      { id: 'col-b', name: 'Inertia', order: 1 },
    ])
    const result = await denormalizeStatus(mockConfig, 'proj-1', 'inertia', prefixDeps)
    expect(result).toBe('inertia')
  })

  test('returns the input slug unchanged when no column matches', async () => {
    const result = await denormalizeStatus(mockConfig, 'proj-1', 'zzz', columnsReturning(defaultColumns))
    expect(result).toBe('zzz')
  })
})
