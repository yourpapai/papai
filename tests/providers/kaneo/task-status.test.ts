import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { getUserMessage } from '../../../src/errors.js'
import { KaneoClassifiedError } from '../../../src/providers/kaneo/classify-error.js'
import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import type { TaskStatusDeps } from '../../../src/providers/kaneo/task-status.js'
import { validateStatus } from '../../../src/providers/kaneo/task-status.js'
import { mockLogger } from '../../utils/test-helpers.js'

type ColumnEntry = { id: string; name: string; order: number }

const defaultColumns: ColumnEntry[] = [
  { id: 'col-1', name: 'To Do', order: 0 },
  { id: 'col-2', name: 'In Progress', order: 1 },
  { id: 'col-3', name: 'Done', order: 2 },
]

describe('validateStatus', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://test.kaneo.app',
  }

  let deps: TaskStatusDeps

  beforeEach(() => {
    mockLogger()

    deps = {
      listColumns: (): Promise<ColumnEntry[]> => Promise.resolve(defaultColumns),
    }
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

    test('error includes invalid status name', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'InvalidStatus', deps)
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(Error)
      assert(thrownError instanceof Error)
      expect(thrownError.message).toContain('InvalidStatus')
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
      expect(message).toContain('NonExistent')
      expect(message).toContain('To Do')
      expect(message).toContain('In Progress')
      expect(message).toContain('Done')
    })
  })

  describe('with custom project columns', () => {
    test('validates against custom project columns', async () => {
      const customDeps: TaskStatusDeps = {
        listColumns: (): Promise<ColumnEntry[]> =>
          Promise.resolve([
            { id: 'col-x', name: 'Backlog', order: 0 },
            { id: 'col-y', name: 'Shipped', order: 1 },
          ]),
      }
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
      expect(message).toContain('Review')
      expect(message).toContain('To Do')
      expect(message).toContain('In Progress')
      expect(message).toContain('Done')
    })
  })
})
