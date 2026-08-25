// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import {
  classifyYouTrackError,
  YouTrackClassifiedError,
} from '../../../plugins/task-provider-youtrack/classify-error.js'
import { YouTrackApiError } from '../../../plugins/task-provider-youtrack/client.js'
import { getUserMessage, providerError, systemError } from '../../../src/errors.js'
import { assertEach, type Row } from '../../utils/grouped-assertions.js'

/**
 * One row per former case: the error (and optional context) fed to classifyYouTrackError,
 * plus the former case's assertions verbatim in `check`, run against the classified result.
 */
type ClassifyRow = Row<{
  readonly error: unknown
  readonly context?: { taskId?: string; projectId?: string; commentId?: string; labelId?: string; queryId?: string }
  readonly check: (result: ReturnType<typeof classifyYouTrackError>) => void
}>

const runClassifyMatrix = (rows: readonly ClassifyRow[]): Promise<void> =>
  assertEach(rows, (row) => {
    row.check(classifyYouTrackError(row.error, row.context))
  })

describe('classifyYouTrackError', () => {
  describe('HTTP status code classification', () => {
    test('status code matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'returns authFailed for 401',
          error: new YouTrackApiError('Unauthorized', 401, {}),
          check: (result) => {
            expect(result.appError).toEqual(providerError.authFailed())
          },
        },
        {
          label: 'returns authFailed for 403',
          error: new YouTrackApiError('Forbidden', 403, {}),
          check: (result) => {
            expect(result.appError).toEqual(providerError.authFailed())
          },
        },
        {
          label: 'returns rateLimited for 429',
          error: new YouTrackApiError('Too many requests', 429, {}),
          check: (result) => {
            expect(result.appError).toEqual(providerError.rateLimited())
          },
        },
        {
          label: 'returns taskNotFound for 404 with issue in message',
          error: new YouTrackApiError('Issue not found', 404, {}),
          check: (result) => {
            expect(result.appError.code).toBe('task-not-found')
          },
        },
        {
          label: 'returns projectNotFound for 404 with project in message',
          error: new YouTrackApiError('Project not found', 404, {}),
          check: (result) => {
            expect(result.appError.code).toBe('project-not-found')
          },
        },
        {
          label: 'returns commentNotFound for 404 with comment in message',
          error: new YouTrackApiError('Comment not found', 404, {}),
          check: (result) => {
            expect(result.appError.code).toBe('comment-not-found')
          },
        },
        {
          label: 'returns labelNotFound for 404 with tag in message',
          error: new YouTrackApiError('Tag not found', 404, {}),
          check: (result) => {
            expect(result.appError.code).toBe('label-not-found')
          },
        },
        {
          label: 'returns notFound for 404 with saved query in message',
          error: new YouTrackApiError('Saved query not found', 404, {}),
          context: { queryId: 'query-404' },
          check: (result) => {
            expect(result.appError).toEqual(providerError.notFound('Saved query', 'query-404'))
          },
        },
        {
          label: 'returns unknown for 404 without recognisable resource type',
          error: new YouTrackApiError('Not found', 404, {}),
          check: (result) => {
            expect(result.appError.code).toBe('unknown')
          },
        },
        {
          label: 'returns validationFailed for 400',
          error: new YouTrackApiError('Bad request', 400, {}),
          check: (result) => {
            expect(result.appError.code).toBe('validation-failed')
          },
        },
        {
          label: 'returns unexpected for 500 server error',
          error: new YouTrackApiError('Internal Server Error', 500, {}),
          check: (result) => {
            expect(result.appError.code).toBe('unexpected')
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('with context parameter', () => {
    test('context matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'preserves taskId in 404 task-not-found error',
          error: new YouTrackApiError('Issue not found', 404, {}),
          context: { taskId: 'PROJ-42' },
          check: (result) => {
            expect(result.appError.code).toBe('task-not-found')
            expect(result.appError).toHaveProperty('taskId', 'PROJ-42')
            expect(getUserMessage(result.appError)).toContain('PROJ-42')
          },
        },
        {
          label: 'preserves projectId in 404 project-not-found error',
          error: new YouTrackApiError('Project not found', 404, {}),
          context: { projectId: 'MY-PROJECT' },
          check: (result) => {
            expect(result.appError.code).toBe('project-not-found')
            expect(result.appError).toHaveProperty('projectId', 'MY-PROJECT')
          },
        },
        {
          label: 'preserves commentId in 404 comment-not-found error',
          error: new YouTrackApiError('Comment not found', 404, {}),
          context: { commentId: 'COMMENT-1' },
          check: (result) => {
            expect(result.appError.code).toBe('comment-not-found')
            expect(result.appError).toHaveProperty('commentId', 'COMMENT-1')
          },
        },
        {
          label: 'preserves labelId in 404 label-not-found error',
          error: new YouTrackApiError('Tag not found', 404, {}),
          context: { labelId: 'TAG-99' },
          check: (result) => {
            expect(result.appError.code).toBe('label-not-found')
            expect(result.appError).toHaveProperty('labelName', 'TAG-99')
          },
        },
        {
          label: 'falls back to unknown when no context provided for 404',
          error: new YouTrackApiError('Issue not found', 404, {}),
          check: (result) => {
            expect(result.appError).toHaveProperty('taskId', 'unknown')
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('network error detection', () => {
    test('network detection matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'detects TypeError with fetch failed message',
          error: new TypeError('fetch failed'),
          check: (result) => {
            expect(result.appError.code).toBe('network-error')
          },
        },
        {
          label: 'detects TypeError with ECONNREFUSED',
          error: new TypeError('connect ECONNREFUSED 127.0.0.1:8080'),
          check: (result) => {
            expect(result.appError.code).toBe('network-error')
          },
        },
        {
          label: 'detects TypeError with ENOTFOUND',
          error: new TypeError('getaddrinfo ENOTFOUND youtrack.example.com'),
          check: (result) => {
            expect(result.appError.code).toBe('network-error')
          },
        },
        {
          label: 'detects Error with network in message',
          error: new Error('Network request failed'),
          check: (result) => {
            expect(result.appError.code).toBe('network-error')
          },
        },
        {
          label: 'detects Error with connect in message',
          error: new Error('Failed to connect to server'),
          check: (result) => {
            expect(result.appError.code).toBe('network-error')
          },
        },
        {
          label: 'getUserMessage for network-error has user-friendly text',
          error: new TypeError('fetch failed'),
          check: (result) => {
            const message = getUserMessage(result.appError)
            expect(message.toLowerCase()).toMatch(/unavailable|connection/u)
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('generic error handling', () => {
    test('generic handling matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'returns authFailed for Error with unauthorized message',
          error: new Error('Unauthorized access'),
          check: (result) => {
            expect(result.appError.code).toBe('auth-failed')
          },
        },
        {
          label: 'returns rateLimited for Error with rate limit message',
          error: new Error('Rate limit exceeded'),
          check: (result) => {
            expect(result.appError.code).toBe('rate-limited')
          },
        },
        {
          label: 'returns unexpected for plain Error',
          error: new Error('Something went wrong'),
          check: (result) => {
            expect(result.appError.code).toBe('unexpected')
          },
        },
        {
          label: 'handles null error gracefully',
          error: null,
          check: (result) => {
            expect(result.appError.code).toBe('unexpected')
          },
        },
        {
          label: 'handles undefined error gracefully',
          error: undefined,
          check: (result) => {
            expect(result.appError.code).toBe('unexpected')
          },
        },
        {
          label: 'handles string error gracefully',
          error: 'something went wrong',
          check: (result) => {
            expect(result.appError.code).toBe('unexpected')
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('returns YouTrackClassifiedError', () => {
    const alreadyClassified = new YouTrackClassifiedError('Already classified', providerError.taskNotFound('T-1'))

    test('result type matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'result is an instance of YouTrackClassifiedError',
          error: new YouTrackApiError('Issue not found', 404, {}),
          context: { taskId: 'T-1' },
          check: (result) => {
            expect(result).toBeInstanceOf(YouTrackClassifiedError)
            expect(result).toBeInstanceOf(Error)
          },
        },
        {
          label: 'preserves already classified errors',
          error: alreadyClassified,
          check: (result) => {
            expect(result).toBe(alreadyClassified)
          },
        },
        {
          label: 'carries appError payload with getUserMessage support',
          error: new YouTrackApiError('Issue not found', 404, {}),
          context: { taskId: 'PROJ-99' },
          check: (result) => {
            const message = getUserMessage(result.appError)
            expect(message).toContain('PROJ-99')
            expect(message).toContain('not found')
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('workflow validation errors', () => {
    test('workflow validation matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'classifies 400 with error_type workflow as workflow-validation-failed',
          error: new YouTrackApiError('Bad request', 400, {
            error: 'Assertion failed',
            error_description: 'Please fill in "URL address" or "Service Discovery name".',
            error_type: 'workflow',
          }),
          context: { projectId: 'PROJ-1' },
          check: (result) => {
            assert.equal(result.appError.code, 'workflow-validation-failed')
            expect(result.appError.requiredFields.length).toBeGreaterThan(0)
          },
        },
        {
          label: 'extracts quoted field names from Russian workflow error',
          error: new YouTrackApiError('Bad request', 400, {
            error: 'Assertion failed',
            error_description:
              '\u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u0437\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 "URL \u0430\u0434\u0435\u0441\u0430 \u0433\u0434\u0435 \u0431\u0443\u0434\u0435\u0442 \u0440\u0430\u0437\u043C\u0435\u0449\u0430\u0442\u044C\u0441\u044F \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438" (\u0441 \u0443\u043A\u0430\u0437\u0430\u043D\u0438\u0435\u043C \u043F\u0440\u043E\u0442\u043E\u043A\u043E\u043B\u0430 http(s)://) \u0438\u043B\u0438 "\u0418\u043C\u044F \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u0432 Service Discovery".',
            error_type: 'workflow',
          }),
          context: { projectId: '39-1118' },
          check: (result) => {
            assert.equal(result.appError.code, 'workflow-validation-failed')
            const fieldNames = result.appError.requiredFields.map((f) => f.name)
            expect(fieldNames).toContain('URL адеса где будет размещаться приложени')
            expect(fieldNames).toContain('Имя приложения в Service Discovery')
          },
        },
        {
          label: 'extracts quoted field names with smart quotes',
          error: new YouTrackApiError('Bad request', 400, {
            error: 'Assertion failed',
            error_description:
              '\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u00ABURL\u00BB \u0438\u043B\u0438 \u00ABName\u00BB.',
            error_type: 'workflow',
          }),
          check: (result) => {
            assert.equal(result.appError.code, 'workflow-validation-failed')
            const fieldNames = result.appError.requiredFields.map((f) => f.name)
            expect(fieldNames).toContain('URL')
            expect(fieldNames).toContain('Name')
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('user-friendly messages', () => {
    test('user message matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'task-not-found includes taskId',
          error: new YouTrackApiError('Issue not found', 404, {}),
          context: { taskId: 'PROJ-123' },
          check: (result) => {
            const message = getUserMessage(result.appError)
            expect(message).toContain('PROJ-123')
          },
        },
        {
          label: 'auth-failed has descriptive message',
          error: new YouTrackApiError('Unauthorized', 401, {}),
          check: (result) => {
            const message = getUserMessage(result.appError)
            expect(message.toLowerCase()).toMatch(/api key|connect/u)
          },
        },
        {
          label: 'network-error message mentions retry',
          error: new TypeError('fetch failed'),
          check: (result) => {
            const message = getUserMessage(result.appError)
            expect(message.toLowerCase()).toContain('try again')
          },
        },
        {
          label: 'network-error message is from systemError',
          error: new TypeError('fetch failed'),
          check: (result) => {
            expect(result.appError).toEqual(systemError.networkError('fetch failed'))
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('isYouTrackErrorBody body validation', () => {
    test('body validation matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'falls back to constructor message when a known key holds a non-string value',
          error: new YouTrackApiError('Constructor message', 500, { error: 123 }),
          check: (result) => {
            expect(result.message).toBe('Constructor message')
            expect(result.appError.code).toBe('unexpected')
          },
        },
        {
          label: 'does not throw and falls back when body is null',
          error: new YouTrackApiError('Constructor message', 500, null),
          check: (result) => {
            expect(result.message).toBe('Constructor message')
            expect(result.appError.code).toBe('unexpected')
          },
        },
        {
          label: 'keeps a body valid when a foreign key holds a non-string value',
          error: new YouTrackApiError('Constructor message', 500, { error: 'Body message', extra: 9 }),
          check: (result) => {
            expect(result.message).toBe('Body message')
          },
        },
        {
          label: 'prefers error_description over error and constructor message',
          error: new YouTrackApiError('Constructor message', 401, {
            error_description: 'Descriptive message',
            error: 'Short error',
          }),
          check: (result) => {
            expect(result.message).toBe('Descriptive message')
          },
        },
        {
          label: 'falls back to error when error_description is absent',
          error: new YouTrackApiError('Constructor message', 401, { error: 'Short error' }),
          check: (result) => {
            expect(result.message).toBe('Short error')
          },
        },
        {
          label: 'treats a non-string error_description value as an invalid body',
          error: new YouTrackApiError('Constructor message', 500, { error_description: 123 }),
          check: (result) => {
            expect(result.message).toBe('Constructor message')
          },
        },
        {
          label: 'uses error when error_description is explicitly undefined',
          error: new YouTrackApiError('Constructor message', 500, {
            error_description: undefined,
            error: 'Body error',
          }),
          check: (result) => {
            expect(result.message).toBe('Body error')
          },
        },
        {
          label: 'treats a non-string error_type value as an invalid body even when error is present',
          error: new YouTrackApiError('Constructor message', 500, {
            error_type: 123,
            error: 'Body message',
          }),
          check: (result) => {
            expect(result.message).toBe('Constructor message')
          },
        },
        {
          label: 'treats a non-string error_rule_name value as an invalid body on the 400 path',
          error: new YouTrackApiError('Bad request', 400, {
            error_type: 'workflow',
            error_rule_name: 123,
          }),
          check: (result) => {
            expect(result.appError.code).toBe('validation-failed')
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('normalizeFieldName cleaning', () => {
    test('field name cleaning matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'trims surrounding whitespace from a field name',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required field:    Spaced    ',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'Spaced' }])
          },
        },
        {
          label: 'strips surrounding quotes from a field name',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required field: "Quoted"',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'Quoted' }])
          },
        },
        {
          label: 'strips every layer of surrounding quotes and whitespace',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: "required fields: ''URL''",
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'URL' }])
          },
        },
        {
          label: 'collapses internal double spaces to a single space',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required field: double  space',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'double space' }])
          },
        },
        {
          label: 'drops a name that is empty after trimming',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required fields:    ',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [])
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('normalizeFieldName stopword filter', () => {
    test('stopword matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'drops the stopword "field"',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required field: field',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [])
          },
        },
        {
          label: 'drops the stopword "fields"',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required field: fields',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [])
          },
        },
        {
          label: 'drops the stopword "custom field"',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required field: custom field',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [])
          },
        },
        {
          label: 'drops the stopword "custom fields"',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required field: custom fields',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [])
          },
        },
        {
          label: 'matches stopwords case-insensitively via toLowerCase',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required field: Field',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [])
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('appendFieldNames separator rewrite', () => {
    test('separator rewrite matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'splits a list joined by " and " into separate names',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required fields: Alpha and Beta',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'Alpha' }, { name: 'Beta' }])
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('extractRequiredFields pattern matching', () => {
    test('pattern matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'harvests fields from the error_rule_name candidate',
          error: new YouTrackApiError('Bad request', 400, {
            error_rule_name: 'required field: FromRule',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'FromRule' }])
          },
        },
        {
          label: 'matches the "requires these custom fields:" list pattern',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'requires these custom fields: URL, Name',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'URL' }, { name: 'Name' }])
          },
        },
        {
          label: 'matches the "requires these custom fields:" list with no space after the colon',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'requires these custom fields:URL, Name',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'URL' }, { name: 'Name' }])
          },
        },
        {
          label: 'matches the singular "required field:" pattern',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required field: Solo',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'Solo' }])
          },
        },
        {
          label: 'matches the singular "required field:" pattern with no space after the colon',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required field:Solo',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'Solo' }])
          },
        },
        {
          label: 'matches the plural "required fields:" pattern',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'required fields: Aaa, Bbb',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'Aaa' }, { name: 'Bbb' }])
          },
        },
        {
          label: 'matches the unquoted "field X is required" pattern',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'field URL is required',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'URL' }])
          },
        },
        {
          label: 'does not run the quoted fallback once a primary pattern matched',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'requires these custom fields: Primary. Fill "Extra"',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'Primary' }])
          },
        },
        {
          label: 'quoted fallback tolerates an absent error_description candidate',
          error: new YouTrackApiError('fill "Msg"', 400, { error_type: 'workflow' }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [{ name: 'Msg' }])
          },
        },
        {
          label: 'field-is-required path drops a captured stopword name',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'field custom field is required',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [])
          },
        },
        {
          label: 'quoted fallback drops a captured stopword name',
          error: new YouTrackApiError('fill "field" please', 400, { error_type: 'workflow' }),
          check: (result) => {
            expect(result.appError).toHaveProperty('requiredFields', [])
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('classifyWorkflowValidationError context', () => {
    test('workflow context matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'preserves the provided projectId',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'requires these custom fields: X',
            error_type: 'workflow',
          }),
          context: { projectId: 'PROJ-9' },
          check: (result) => {
            expect(result.appError).toHaveProperty('projectId', 'PROJ-9')
          },
        },
        {
          label: 'falls back to projectId "unknown" when no context is given',
          error: new YouTrackApiError('Bad request', 400, {
            error_description: 'requires these custom fields: X',
            error_type: 'workflow',
          }),
          check: (result) => {
            expect(result.appError).toHaveProperty('projectId', 'unknown')
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('classifyApiError 400 invalid body', () => {
    test('invalid 400 body matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'classifies a 400 with an invalid body as validation-failed without throwing',
          error: new YouTrackApiError('Bad request', 400, { error_description: 123 }),
          check: (result) => {
            expect(result.appError.code).toBe('validation-failed')
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('classifyNotFoundError context fallbacks', () => {
    test('not-found fallback matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'falls back to projectId "unknown" when no context is given',
          error: new YouTrackApiError('Project not found', 404, {}),
          check: (result) => {
            expect(result.appError.code).toBe('project-not-found')
            expect(result.appError).toHaveProperty('projectId', 'unknown')
          },
        },
        {
          label: 'falls back to commentId "unknown" when no context is given',
          error: new YouTrackApiError('Comment not found', 404, {}),
          check: (result) => {
            expect(result.appError.code).toBe('comment-not-found')
            expect(result.appError).toHaveProperty('commentId', 'unknown')
          },
        },
        {
          label: 'falls back to labelName "unknown" when no context is given',
          error: new YouTrackApiError('Tag not found', 404, {}),
          check: (result) => {
            expect(result.appError.code).toBe('label-not-found')
            expect(result.appError).toHaveProperty('labelName', 'unknown')
          },
        },
        {
          label: 'falls back to resourceId "unknown" for a saved query without context',
          error: new YouTrackApiError('saved query not found', 404, {}),
          check: (result) => {
            expect(result.appError.code).toBe('not-found')
            expect(result.appError).toHaveProperty('resourceType', 'Saved query')
            expect(result.appError).toHaveProperty('resourceId', 'unknown')
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })

  describe('YouTrackClassifiedError name', () => {
    test('error name matrix', async () => {
      const rows: readonly ClassifyRow[] = [
        {
          label: 'sets the error name to YouTrackClassifiedError',
          error: new YouTrackApiError('Issue not found', 404, {}),
          context: { taskId: 'T-1' },
          check: (result) => {
            expect(result.name).toBe('YouTrackClassifiedError')
          },
        },
      ]
      await runClassifyMatrix(rows)
    })
  })
})
