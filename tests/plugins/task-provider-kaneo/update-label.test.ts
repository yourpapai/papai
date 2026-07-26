// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { KaneoClassifiedError } from '../../../plugins/task-provider-kaneo/classify-error.js'
import type { KaneoConfig } from '../../../plugins/task-provider-kaneo/client.js'
import { updateLabel } from '../../../plugins/task-provider-kaneo/update-label.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

// ---------------------------------------------------------------------------
// Helpers (defined outside all test/describe blocks)
// ---------------------------------------------------------------------------

function getRequestMethod(options: RequestInit): string {
  return options.method ?? 'GET'
}

function parseBodyIfPut(options: RequestInit): unknown {
  if (options.method !== 'PUT') return undefined
  assert(typeof options.body === 'string')
  return JSON.parse(options.body)
}

/**
 * Capture the PUT body and return distinct GET vs PUT responses. The GET
 * response carries the "old" field values so the params-vs-existing merge
 * inside `client.labels.update` is observable: a mutant that drops fields
 * from the `{ name, color }` body would fall back to the old values and the
 * PUT-body assertion would fail.
 */
function capturePutWithDistinctResponses(
  captured: { value: unknown },
  getResponse: object,
  putResponse: object,
): (url: string, options: RequestInit) => Promise<Response> {
  return (_url, options) => {
    captured.value = parseBodyIfPut(options)
    const body = options.method === 'PUT' ? putResponse : getResponse
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  }
}

describe('updateLabel', () => {
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

  test('updates name, preserving color from the existing label', async () => {
    const captured = { value: undefined as unknown }
    setMockFetch(
      capturePutWithDistinctResponses(
        captured,
        { id: 'label-1', name: 'Old Name', color: '#aabbcc' },
        { id: 'label-1', name: 'Updated', color: '#aabbcc' },
      ),
    )

    const result = await updateLabel({ config: mockConfig, labelId: 'label-1', name: 'Updated' })

    expect(captured.value).toEqual({ name: 'Updated', color: '#aabbcc' })
    expect(result).toMatchObject({ id: 'label-1', name: 'Updated' })
  })

  test('updates color, preserving name from the existing label', async () => {
    const captured = { value: undefined as unknown }
    setMockFetch(
      capturePutWithDistinctResponses(
        captured,
        { id: 'label-1', name: 'Existing', color: '#old' },
        { id: 'label-1', name: 'Existing', color: '#00ff00' },
      ),
    )

    await updateLabel({ config: mockConfig, labelId: 'label-1', color: '#00ff00' })

    expect(captured.value).toEqual({ name: 'Existing', color: '#00ff00' })
  })

  test('updates both name and color', async () => {
    const captured = { value: undefined as unknown }
    setMockFetch(
      capturePutWithDistinctResponses(
        captured,
        { id: 'label-1', name: 'Old', color: '#old' },
        { id: 'label-1', name: 'New', color: '#0000ff' },
      ),
    )

    await updateLabel({ config: mockConfig, labelId: 'label-1', name: 'New', color: '#0000ff' })

    expect(captured.value).toEqual({ name: 'New', color: '#0000ff' })
  })

  test('rejects with KaneoClassifiedError before any fetch when neither name nor color is provided', async () => {
    const fetchSpy = mock<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'label-1', name: 'n', color: '#ff0000' }), { status: 200 })),
    )
    setMockFetch((url: string, init: RequestInit) => fetchSpy(url, init))

    await expect(updateLabel({ config: mockConfig, labelId: 'label-1' })).rejects.toBeInstanceOf(KaneoClassifiedError)

    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  test('classifies API errors as KaneoClassifiedError', async () => {
    setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Label not found' }), { status: 404 })))

    await expect(updateLabel({ config: mockConfig, labelId: 'invalid', name: 'x' })).rejects.toBeInstanceOf(
      KaneoClassifiedError,
    )
  })

  // Endpoint contract for the GET-then-PUT wire shape (the provider's
  // updateLabel calls client.labels.update, which fetches the existing label
  // then PUTs the merged body). Log-payload / message-string survivors are
  // intentionally not chased — see
  // docs/superpowers/specs/2026-07-25-plugin-test-quality-design.md.
  describe('HTTP method and path contract', () => {
    test('GETs then PUTs /api/label/:id', async () => {
      const requests: Array<{ url: string; method: string }> = []
      setMockFetch((url, options) => {
        requests.push({ url, method: getRequestMethod(options) })
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'label-1', name: 'n', color: '#ff0000' }), { status: 200 }),
        )
      })

      await updateLabel({ config: mockConfig, labelId: 'label-1', name: 'n' })

      expect(requests).toEqual([
        { url: 'https://api.test.com/api/label/label-1', method: 'GET' },
        { url: 'https://api.test.com/api/label/label-1', method: 'PUT' },
      ])
    })
  })
})
