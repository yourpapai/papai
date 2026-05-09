import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { providerError } from '../../../../src/errors.js'
import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import { applyYouTrackCommand } from '../../../../src/providers/youtrack/operations/commands.js'
import { mockLogger, restoreFetch } from '../../../utils/test-helpers.js'
import { type FetchMockFn, defaultConfig, getLastFetchBody, installFetchMock } from '../fetch-mock-utils.js'

const fetchMock: { current?: FetchMockFn } = {}

const config: YouTrackConfig = defaultConfig

beforeEach(() => {
  mockLogger()
})

afterEach(() => {
  restoreFetch()
})

describe('applyYouTrackCommand', () => {
  test('posts a command using readable issue IDs', async () => {
    installFetchMock(fetchMock, () =>
      Promise.resolve(
        new Response(JSON.stringify({ query: 'for me', issues: [{ id: '2-15', idReadable: 'TEST-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await applyYouTrackCommand(config, {
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: 'Assigning to myself',
      silent: true,
    })

    expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1'], comment: 'Assigning to myself', silent: true })
    expect(fetchMock.current?.mock.calls).toHaveLength(1)
    const body = getLastFetchBody(fetchMock.current)
    expect(body).toEqual({
      query: 'for me',
      issues: [{ idReadable: 'TEST-1' }],
      comment: 'Assigning to myself',
      silent: true,
    })
  })

  test('classifies 400 responses through the normal provider error path', async () => {
    installFetchMock(fetchMock, () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'Command not valid', error_description: 'Command not valid' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    try {
      await applyYouTrackCommand(config, { query: 'bad command', taskIds: ['TEST-1'] })
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      assert(error instanceof YouTrackClassifiedError)

      expect(error.appError).toEqual(providerError.validationFailed('unknown', 'Command not valid'))
    }
  })

  test('routes malformed success responses through the normal provider error path', async () => {
    installFetchMock(fetchMock, () =>
      Promise.resolve(
        new Response(JSON.stringify({ issues: [{ idReadable: 'TEST-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    try {
      await applyYouTrackCommand(config, { query: 'for me', taskIds: ['TEST-1'] })
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      assert(error instanceof YouTrackClassifiedError)

      expect(error.appError).toEqual(providerError.invalidResponse())
    }
  })
})
