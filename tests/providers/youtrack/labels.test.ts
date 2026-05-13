import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { YouTrackClassifiedError } from '../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import {
  addYouTrackTaskLabel,
  createYouTrackLabel,
  findYouTrackLabelsByName,
  listYouTrackLabels,
  removeYouTrackLabel,
  removeYouTrackTaskLabel,
  updateYouTrackLabel,
} from '../../../src/providers/youtrack/labels.js'
import { mockLogger, restoreFetch } from '../../utils/test-helpers.js'
import {
  type FetchMockFn,
  defaultConfig,
  getFetchBodyAt,
  getFetchMethodAt,
  getFetchUrlAt,
  getLastFetchBody,
  getLastFetchMethod,
  getLastFetchUrl,
  installFetchMock,
  mockFetchError,
  mockFetchNoContent,
  mockFetchResponse,
} from './fetch-mock-utils.js'

const fetchMock: { current?: FetchMockFn } = {}

const config: YouTrackConfig = defaultConfig

// --- Fixtures ---

type TagFixture = Record<string, unknown>

const makeTagResponse = (overrides: Record<string, unknown> = {}): TagFixture => ({
  id: 'tag-1',
  name: 'bug',
  color: { id: 'c-1', background: '#ff0000' },
  ...overrides,
})

// --- Tests ---

beforeEach(() => {
  mockLogger()
})

describe('listYouTrackLabels', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('returns mapped labels', async () => {
    mockFetchResponse(fetchMock, [
      makeTagResponse(),
      makeTagResponse({ id: 'tag-2', name: 'feature', color: { id: 'c-2', background: '#00ff00' } }),
    ])

    const labels = await listYouTrackLabels(config)

    expect(labels).toHaveLength(2)
    expect(labels[0]!.id).toBe('tag-1')
    expect(labels[0]!.name).toBe('bug')
    expect(labels[0]!.color).toBe('#ff0000')
    expect(labels[1]!.id).toBe('tag-2')
    expect(labels[1]!.name).toBe('feature')
    expect(labels[1]!.color).toBe('#00ff00')
  })

  test('maps color to undefined when color is null', async () => {
    mockFetchResponse(fetchMock, [makeTagResponse({ color: null })])

    const labels = await listYouTrackLabels(config)

    expect(labels[0]!.color).toBeUndefined()
  })

  test('maps color to undefined when color field is absent', async () => {
    const tag = makeTagResponse()
    delete tag['color']
    mockFetchResponse(fetchMock, [tag])

    const labels = await listYouTrackLabels(config)

    expect(labels[0]!.color).toBeUndefined()
  })

  test('returns empty array when no labels', async () => {
    mockFetchResponse(fetchMock, [])

    const labels = await listYouTrackLabels(config)

    expect(labels).toEqual([])
  })

  test('uses GET method to /api/tags', async () => {
    mockFetchResponse(fetchMock, [])

    await listYouTrackLabels(config)

    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/tags')
    expect(url.searchParams.get('$top')).toBe('100')
    expect(getLastFetchMethod(fetchMock.current)).toBe('GET')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(fetchMock, 500)

    await expect(listYouTrackLabels(config)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('createYouTrackLabel', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('creates label and returns mapped result', async () => {
    mockFetchResponse(fetchMock, makeTagResponse({ id: 'new-tag', name: 'urgent' }))

    const label = await createYouTrackLabel(config, { name: 'urgent' })

    expect(label.id).toBe('new-tag')
    expect(label.name).toBe('urgent')
    expect(label.color).toBe('#ff0000')
  })

  test('sends name in request body', async () => {
    mockFetchResponse(fetchMock, makeTagResponse())

    await createYouTrackLabel(config, { name: 'my-label' })

    const body = getLastFetchBody(fetchMock.current)
    expect(body['name']).toBe('my-label')
  })

  test('sends color in request body when provided', async () => {
    mockFetchResponse(
      fetchMock,
      makeTagResponse({ id: 'tag-123', name: 'Colored Tag', color: { id: 'color-1', background: '#FF5722' } }),
    )

    await createYouTrackLabel(config, { name: 'Colored Tag', color: '#FF5722' })

    const body = getLastFetchBody(fetchMock.current)
    expect(body['name']).toBe('Colored Tag')
    expect(body['color']).toEqual({ background: '#FF5722' })
  })

  test('maps color from response when present', async () => {
    mockFetchResponse(fetchMock, makeTagResponse({ color: { id: 'c-1', background: '#0000ff' } }))

    const label = await createYouTrackLabel(config, { name: 'test' })

    expect(label.color).toBe('#0000ff')
  })

  test('maps color to undefined when null', async () => {
    mockFetchResponse(fetchMock, makeTagResponse({ color: null }))

    const label = await createYouTrackLabel(config, { name: 'test' })

    expect(label.color).toBeUndefined()
  })

  test('uses POST method to /api/tags', async () => {
    mockFetchResponse(fetchMock, makeTagResponse())

    await createYouTrackLabel(config, { name: 'test' })

    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/tags')
    expect(getLastFetchMethod(fetchMock.current)).toBe('POST')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(fetchMock, 400)

    await expect(createYouTrackLabel(config, { name: 'test' })).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('findYouTrackLabelsByName', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('queries tags by name and returns exact visible matches', async () => {
    mockFetchResponse(fetchMock, [
      makeTagResponse({ id: 'tag-1', name: 'blocked' }),
      makeTagResponse({ id: 'tag-2', name: 'blocked' }),
      makeTagResponse({ id: 'tag-3', name: 'blocking' }),
    ])

    const result = await findYouTrackLabelsByName(config, 'blocked')

    expect(result).toEqual([
      { id: 'tag-1', name: 'blocked', color: '#ff0000' },
      { id: 'tag-2', name: 'blocked', color: '#ff0000' },
    ])
  })

  test('sends the tag name as the server-side query parameter', async () => {
    mockFetchResponse(fetchMock, [])

    await findYouTrackLabelsByName(config, 'blocked')

    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/tags')
    expect(url.searchParams.get('query')).toBe('blocked')
    expect(getLastFetchMethod(fetchMock.current)).toBe('GET')
  })

  test('paginates through tag results when exact match is not on the first page', async () => {
    const responses: Response[] = [
      new Response(
        JSON.stringify(
          Array.from({ length: 100 }, (_, index) => makeTagResponse({ id: `tag-${index}`, name: `other-${index}` })),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
      new Response(JSON.stringify([makeTagResponse({ id: 'tag-101', name: 'blocked' })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]
    let callCount = 0
    installFetchMock(fetchMock, () => {
      const response = responses[callCount]
      assert(response !== undefined, `Unexpected fetch call #${callCount}`)
      callCount++
      return Promise.resolve(response)
    })

    const result = await findYouTrackLabelsByName(config, 'blocked')

    expect(result).toEqual([{ id: 'tag-101', name: 'blocked', color: '#ff0000' }])
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('$top')).toBe('100')
    expect(getFetchUrlAt(fetchMock.current, 1).searchParams.get('$skip')).toBe('100')
  })
})

describe('updateYouTrackLabel', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('updates label name and returns mapped result', async () => {
    mockFetchResponse(fetchMock, makeTagResponse({ name: 'updated-name' }))

    const label = await updateYouTrackLabel(config, 'tag-1', { name: 'updated-name' })

    expect(label.id).toBe('tag-1')
    expect(label.name).toBe('updated-name')
  })

  test('sends name in body when provided', async () => {
    mockFetchResponse(fetchMock, makeTagResponse())

    await updateYouTrackLabel(config, 'tag-1', { name: 'new-name' })

    const body = getLastFetchBody(fetchMock.current)
    expect(body['name']).toBe('new-name')
  })

  test('does not send name when absent', async () => {
    mockFetchResponse(fetchMock, makeTagResponse())

    await updateYouTrackLabel(config, 'tag-1', {})

    const body = getLastFetchBody(fetchMock.current)
    expect(body['name']).toBeUndefined()
  })

  test('uses POST method with label id in path', async () => {
    mockFetchResponse(fetchMock, makeTagResponse())

    await updateYouTrackLabel(config, 'tag-1', { name: 'x' })

    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/tags/tag-1')
    expect(getLastFetchMethod(fetchMock.current)).toBe('POST')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(fetchMock, 404, { error: 'Tag not found /tags/' })

    try {
      await updateYouTrackLabel(config, 'nonexistent', { name: 'x' })
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('label-not-found')
    }
  })

  test('updateLabel sends color in request body', async () => {
    mockFetchResponse(
      fetchMock,
      makeTagResponse({ id: 'tag-123', name: 'Updated Tag', color: { id: 'color-1', background: '#FF5722' } }),
    )

    await updateYouTrackLabel(config, 'tag-123', { name: 'Updated Tag', color: '#FF5722' })

    const body = getLastFetchBody(fetchMock.current)
    expect(body['name']).toBe('Updated Tag')
    expect(body['color']).toEqual({ background: '#FF5722' })
  })
})

describe('removeYouTrackLabel', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('removes label and returns id', async () => {
    mockFetchNoContent(fetchMock)

    const result = await removeYouTrackLabel(config, 'tag-1')

    expect(result).toEqual({ id: 'tag-1' })
  })

  test('uses DELETE method with label id in path', async () => {
    mockFetchNoContent(fetchMock)

    await removeYouTrackLabel(config, 'tag-42')

    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/tags/tag-42')
    expect(getLastFetchMethod(fetchMock.current)).toBe('DELETE')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(fetchMock, 404, { error: 'Tag not found /tags/' })

    try {
      await removeYouTrackLabel(config, 'nonexistent')
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('label-not-found')
    }
  })
})

describe('addYouTrackTaskLabel', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('adds label to task and returns ids', async () => {
    mockFetchResponse(fetchMock, { id: 'new-tag', name: 'blocked' })

    const result = await addYouTrackTaskLabel(config, 'TEST-1', 'new-tag')

    expect(result).toEqual({ taskId: 'TEST-1', labelId: 'new-tag' })
  })

  test('uses direct issue tag endpoint with POST body containing the tag id', async () => {
    mockFetchResponse(fetchMock, { id: 'tag-c', name: 'blocked' })

    await addYouTrackTaskLabel(config, 'TEST-1', 'tag-c')

    expect(fetchMock.current).toHaveBeenCalledTimes(1)
    const url = getFetchUrlAt(fetchMock.current, 0)
    expect(url.pathname).toBe('/api/issues/TEST-1/tags')
    expect(getFetchMethodAt(fetchMock.current, 0)).toBe('POST')

    const body = getFetchBodyAt(fetchMock.current, 0)
    expect(body).toEqual({ id: 'tag-c' })
  })

  test('does not fetch the full current tag list before adding', async () => {
    mockFetchResponse(fetchMock, { id: 'tag-1', name: 'blocked' })

    await addYouTrackTaskLabel(config, 'TEST-1', 'tag-1')

    expect(fetchMock.current).toHaveBeenCalledTimes(1)
  })

  test('throws classified error on failure', async () => {
    mockFetchError(fetchMock, 500)

    await expect(addYouTrackTaskLabel(config, 'TEST-1', 'tag-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('removeYouTrackTaskLabel', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('removes label from task and returns ids', async () => {
    mockFetchNoContent(fetchMock)

    const result = await removeYouTrackTaskLabel(config, 'TEST-1', 'tag-remove')

    expect(result).toEqual({ taskId: 'TEST-1', labelId: 'tag-remove' })
  })

  test('uses direct issue tag endpoint with DELETE and tag id in path', async () => {
    mockFetchNoContent(fetchMock)

    await removeYouTrackTaskLabel(config, 'TEST-1', 'tag-b')

    expect(fetchMock.current).toHaveBeenCalledTimes(1)
    const url = getFetchUrlAt(fetchMock.current, 0)
    expect(url.pathname).toBe('/api/issues/TEST-1/tags/tag-b')
    expect(getFetchMethodAt(fetchMock.current, 0)).toBe('DELETE')
  })

  test('does not fetch the full current tag list before removing', async () => {
    mockFetchNoContent(fetchMock)

    await removeYouTrackTaskLabel(config, 'TEST-1', 'tag-1')

    expect(fetchMock.current).toHaveBeenCalledTimes(1)
  })

  test('throws classified error on failure', async () => {
    mockFetchError(fetchMock, 500)

    await expect(removeYouTrackTaskLabel(config, 'TEST-1', 'tag-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})
