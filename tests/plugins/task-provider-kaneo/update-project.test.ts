// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { KaneoClassifiedError } from '../../../plugins/task-provider-kaneo/classify-error.js'
import type { KaneoConfig } from '../../../plugins/task-provider-kaneo/client.js'
import { updateProject } from '../../../plugins/task-provider-kaneo/update-project.js'
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
 * inside `client.projects.update` is observable: a mutant that drops fields
 * from the `{ name, description }` body would fall back to the old values and
 * the PUT-body assertion would fail.
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

describe('updateProject', () => {
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

  test('updates name, preserving description and other fields from the existing project', async () => {
    const captured = { value: undefined as unknown }
    setMockFetch(
      capturePutWithDistinctResponses(
        captured,
        {
          id: 'proj-1',
          name: 'Old Name',
          slug: 'old-slug',
          icon: 'layout',
          description: 'Old description',
          isPublic: false,
        },
        {
          id: 'proj-1',
          name: 'Updated Name',
          slug: 'old-slug',
          icon: 'layout',
          description: 'Old description',
          isPublic: false,
        },
      ),
    )

    const result = await updateProject({
      config: mockConfig,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      name: 'Updated Name',
    })

    expect(captured.value).toMatchObject({
      name: 'Updated Name',
      slug: 'old-slug',
      icon: 'layout',
      description: 'Old description',
      isPublic: false,
    })
    expect(result.name).toBe('Updated Name')
  })

  test('updates description, preserving name and other fields from the existing project', async () => {
    const captured = { value: undefined as unknown }
    setMockFetch(
      capturePutWithDistinctResponses(
        captured,
        {
          id: 'proj-1',
          name: 'Existing',
          slug: 'old-slug',
          icon: 'layout',
          description: 'Old description',
          isPublic: false,
        },
        {
          id: 'proj-1',
          name: 'Existing',
          slug: 'old-slug',
          icon: 'layout',
          description: 'New description',
          isPublic: false,
        },
      ),
    )

    await updateProject({
      config: mockConfig,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      description: 'New description',
    })

    expect(captured.value).toMatchObject({
      name: 'Existing',
      slug: 'old-slug',
      icon: 'layout',
      description: 'New description',
      isPublic: false,
    })
  })

  test('updates both name and description', async () => {
    const captured = { value: undefined as unknown }
    setMockFetch(
      capturePutWithDistinctResponses(
        captured,
        {
          id: 'proj-1',
          name: 'Old Name',
          slug: 'old-slug',
          icon: 'layout',
          description: 'Old description',
          isPublic: false,
        },
        {
          id: 'proj-1',
          name: 'New Name',
          slug: 'old-slug',
          icon: 'layout',
          description: 'New description',
          isPublic: false,
        },
      ),
    )

    await updateProject({
      config: mockConfig,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      name: 'New Name',
      description: 'New description',
    })

    expect(captured.value).toMatchObject({ name: 'New Name', description: 'New description' })
  })

  test('rejects with KaneoClassifiedError before any fetch when neither name nor description is provided', async () => {
    const fetchSpy = mock<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ id: 'proj-1', name: 'n', slug: 's', icon: '', description: '', isPublic: false }),
          { status: 200 },
        ),
      ),
    )
    setMockFetch((url: string, init: RequestInit) => fetchSpy(url, init))

    await expect(
      updateProject({ config: mockConfig, workspaceId: 'ws-1', projectId: 'proj-1' }),
    ).rejects.toBeInstanceOf(KaneoClassifiedError)

    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  test('classifies API errors as KaneoClassifiedError', async () => {
    setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })))

    await expect(
      updateProject({ config: mockConfig, workspaceId: 'ws-1', projectId: 'invalid', name: 'x' }),
    ).rejects.toBeInstanceOf(KaneoClassifiedError)
  })

  // Endpoint contract for the GET-then-PUT wire shape (the provider's
  // updateProject calls client.projects.update, which fetches the existing
  // project scoped to the workspace, then PUTs the merged body). The GET
  // carries workspaceId as a query param. Log-payload / message-string
  // survivors are intentionally not chased — see
  // docs/superpowers/specs/2026-07-25-plugin-test-quality-design.md.
  describe('HTTP method and path contract', () => {
    test('GETs /api/project/:id?workspaceId=<ws> then PUTs /api/project/:id', async () => {
      const requests: Array<{ url: string; method: string }> = []
      setMockFetch((url, options) => {
        requests.push({ url, method: getRequestMethod(options) })
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'n',
              slug: 's',
              icon: '',
              description: '',
              isPublic: false,
            }),
            { status: 200 },
          ),
        )
      })

      await updateProject({ config: mockConfig, workspaceId: 'ws-1', projectId: 'proj-1', name: 'n' })

      expect(requests).toEqual([
        { url: 'https://api.test.com/api/project/proj-1?workspaceId=ws-1', method: 'GET' },
        { url: 'https://api.test.com/api/project/proj-1', method: 'PUT' },
      ])
    })
  })
})
