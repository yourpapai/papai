import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  addYouTrackComment,
  getYouTrackComment,
  getYouTrackComments,
  removeYouTrackComment,
  updateYouTrackComment,
} from '../../../../src/providers/youtrack/operations/comments.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

// --- Fetch mocking infrastructure ---

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>>

const config: YouTrackConfig = {
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
}

const installFetchMock = (handler: (url: string, init: RequestInit) => Promise<Response>): void => {
  const m = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMock = m
  setMockFetch((url: string, init: RequestInit) => m(url, init))
}

function mockFetchResponse(data: unknown): void
function mockFetchResponse(data: unknown, status: number): void
function mockFetchResponse(...args: [data: unknown] | [data: unknown, status: number]): void {
  const [data, status] = args
  let resolvedStatus = 200
  if (status !== undefined) {
    resolvedStatus = status
  }
  installFetchMock(() =>
    Promise.resolve(
      new Response(JSON.stringify(data), { status: resolvedStatus, headers: { 'Content-Type': 'application/json' } }),
    ),
  )
}

const mockFetchNoContent = (): void => {
  installFetchMock(() => Promise.resolve(new Response(null, { status: 204 })))
}

function mockFetchError(status: number): void
function mockFetchError(status: number, body: unknown): void
function mockFetchError(...args: [status: number] | [status: number, body: unknown]): void {
  const [status, body] = args
  let resolvedBody: unknown = { error: 'Something went wrong' }
  if (body !== undefined) {
    resolvedBody = body
  }
  installFetchMock(() =>
    Promise.resolve(
      new Response(JSON.stringify(resolvedBody), { status, headers: { 'Content-Type': 'application/json' } }),
    ),
  )
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const BodySchema = z.looseObject({})

const getLastFetchUrl = (): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getFetchUrl = (callIndex: number): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[callIndex])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getLastFetchBody = (): z.infer<typeof BodySchema> => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

const getLastFetchMethod = (): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
  if (!parsed.success) return ''
  if (parsed.data[1].method === undefined) return ''
  return parsed.data[1].method
}

// --- Fixtures ---

type CommentFixture = Record<string, unknown>

function makeCommentResponse(): CommentFixture
function makeCommentResponse(overrides: Record<string, unknown>): CommentFixture
function makeCommentResponse(...args: [] | [overrides: Record<string, unknown>]): CommentFixture {
  const overrides = args[0]
  const baseComment: CommentFixture = {
    id: 'comment-1',
    text: 'Test comment body',
    author: { id: 'user-1', login: 'testuser', name: 'Test User' },
    created: 1700000000000,
  }

  if (overrides === undefined) {
    return baseComment
  }

  return {
    ...baseComment,
    ...overrides,
  }
}

function makePaginatedFetchHandler(
  pages: Record<string, unknown[]>,
): (url: string, init: RequestInit) => Promise<Response> {
  return (url) => {
    const requestUrl = new URL(url)
    const skip = requestUrl.searchParams.get('$skip') ?? ''
    const page = pages[skip] ?? []
    return Promise.resolve(
      new Response(JSON.stringify(page), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  }
}

// --- Tests ---

beforeEach(() => {
  mockLogger()
})

describe('addYouTrackComment', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('adds comment and returns mapped result', async () => {
    mockFetchResponse(makeCommentResponse())

    const comment = await addYouTrackComment(config, 'TEST-1', 'Test comment body')

    expect(comment.id).toBe('comment-1')
    expect(comment.body).toBe('Test comment body')
    expect(comment.author).toBe('Test User')
    expect(comment.createdAt).toBeDefined()
  })

  test('maps author login when name is missing', async () => {
    mockFetchResponse(makeCommentResponse({ author: { id: 'user-1', login: 'jdoe' } }))

    const comment = await addYouTrackComment(config, 'TEST-1', 'Hello')

    expect(comment.author).toBe('jdoe')
  })

  test('sends text in request body', async () => {
    mockFetchResponse(makeCommentResponse())

    await addYouTrackComment(config, 'TEST-1', 'My comment text')

    const body = getLastFetchBody()
    expect(body['text']).toBe('My comment text')
  })

  test('uses POST method with task id in path', async () => {
    mockFetchResponse(makeCommentResponse())

    await addYouTrackComment(config, 'TEST-42', 'Hello')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-42/comments')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(400)

    await expect(addYouTrackComment(config, 'TEST-1', 'text')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws classified error on auth failure', async () => {
    mockFetchError(401)

    try {
      await addYouTrackComment(config, 'TEST-1', 'text')
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('auth-failed')
    }
  })
})

describe('getYouTrackComments', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns mapped comments', async () => {
    mockFetchResponse([makeCommentResponse(), makeCommentResponse({ id: 'comment-2', text: 'Second comment' })])

    const comments = await getYouTrackComments(config, 'TEST-1')

    expect(comments).toHaveLength(2)
    expect(comments[0]!.id).toBe('comment-1')
    expect(comments[0]!.body).toBe('Test comment body')
    expect(comments[0]!.author).toBe('Test User')
    expect(comments[0]!.createdAt).toBeDefined()
    expect(comments[1]!.id).toBe('comment-2')
    expect(comments[1]!.body).toBe('Second comment')
  })

  test('returns empty array when no comments', async () => {
    mockFetchResponse([])

    const comments = await getYouTrackComments(config, 'TEST-1')

    expect(comments).toEqual([])
  })

  test('uses GET method with task id in path', async () => {
    mockFetchResponse([])

    await getYouTrackComments(config, 'TEST-1')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-1/comments')
    expect(url.searchParams.get('$top')).toBe('100')
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('passes $top and $skip when pagination params are provided', async () => {
    mockFetchResponse([])

    await getYouTrackComments(config, 'TEST-1', { limit: 20, offset: 40 })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-1/comments')
    expect(url.searchParams.get('$top')).toBe('20')
    expect(url.searchParams.get('$skip')).toBe('40')
  })

  test('continues auto-pagination when only offset is provided', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      makeCommentResponse({
        id: `comment-${index + 41}`,
        text: `Comment ${index + 41}`,
      }),
    )
    const secondPage = [makeCommentResponse({ id: 'comment-141', text: 'Comment 141' })]

    installFetchMock(makePaginatedFetchHandler({ '40': firstPage, '140': secondPage }))

    const comments = await getYouTrackComments(config, 'TEST-1', { offset: 40 })

    expect(comments).toHaveLength(101)
    expect(fetchMock.mock.calls).toHaveLength(2)

    const firstUrl = getFetchUrl(0)
    expect(firstUrl.pathname).toBe('/api/issues/TEST-1/comments')
    expect(firstUrl.searchParams.get('$top')).toBe('100')
    expect(firstUrl.searchParams.get('$skip')).toBe('40')

    const secondUrl = getFetchUrl(1)
    expect(secondUrl.searchParams.get('$top')).toBe('100')
    expect(secondUrl.searchParams.get('$skip')).toBe('140')
  })

  test('uses explicit one-shot pagination when only limit is provided', async () => {
    mockFetchResponse([makeCommentResponse()])

    const comments = await getYouTrackComments(config, 'TEST-1', { limit: 20 })

    expect(comments).toHaveLength(1)
    expect(fetchMock.mock.calls).toHaveLength(1)

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-1/comments')
    expect(url.searchParams.get('$top')).toBe('20')
    expect(url.searchParams.has('$skip')).toBe(false)
  })

  test('throws classified error on failure', async () => {
    mockFetchError(500)

    await expect(getYouTrackComments(config, 'TEST-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('getYouTrackComment', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('fetches single comment by id', async () => {
    mockFetchResponse(makeCommentResponse({ id: 'comment-456', text: 'This is a specific comment' }))

    const comment = await getYouTrackComment(config, 'TEST-1', 'comment-456')

    expect(comment.id).toBe('comment-456')
    expect(comment.body).toBe('This is a specific comment')
    expect(comment.author).toBe('Test User')
    expect(comment.createdAt).toBeDefined()
  })

  test('uses GET method with task and comment id in path', async () => {
    mockFetchResponse(makeCommentResponse())

    await getYouTrackComment(config, 'TEST-1', 'comment-42')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-1/comments/comment-42')
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Comment not found' })

    await expect(getYouTrackComment(config, 'TEST-1', 'nonexistent')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('updateYouTrackComment', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('updates comment and returns mapped result', async () => {
    mockFetchResponse(makeCommentResponse({ text: 'Updated body' }))

    const comment = await updateYouTrackComment(config, {
      taskId: 'TEST-1',
      commentId: 'comment-1',
      body: 'Updated body',
    })

    expect(comment.id).toBe('comment-1')
    expect(comment.body).toBe('Updated body')
  })

  test('sends text in request body', async () => {
    mockFetchResponse(makeCommentResponse())

    await updateYouTrackComment(config, {
      taskId: 'TEST-1',
      commentId: 'comment-1',
      body: 'New text',
    })

    const body = getLastFetchBody()
    expect(body['text']).toBe('New text')
  })

  test('uses POST method with task and comment id in path', async () => {
    mockFetchResponse(makeCommentResponse())

    await updateYouTrackComment(config, {
      taskId: 'TEST-1',
      commentId: 'comment-1',
      body: 'text',
    })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-1/comments/comment-1')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Comment not found /comments/' })

    try {
      await updateYouTrackComment(config, {
        taskId: 'TEST-1',
        commentId: 'nonexistent',
        body: 'text',
      })
      expect.unreachable('Should have thrown')
    } catch (error) {
      // The error message contains /issues/ in the path, so classifyNotFoundError
      // matches the issue check first
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
    }
  })
})

describe('removeYouTrackComment', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('removes comment and returns id', async () => {
    mockFetchNoContent()

    const result = await removeYouTrackComment(config, {
      taskId: 'TEST-1',
      commentId: 'comment-1',
    })

    expect(result).toEqual({ id: 'comment-1' })
  })

  test('uses DELETE method with task and comment id in path', async () => {
    mockFetchNoContent()

    await removeYouTrackComment(config, {
      taskId: 'TEST-1',
      commentId: 'comment-42',
    })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-1/comments/comment-42')
    expect(getLastFetchMethod()).toBe('DELETE')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Comment not found /comments/' })

    try {
      await removeYouTrackComment(config, {
        taskId: 'TEST-1',
        commentId: 'nonexistent',
      })
      expect.unreachable('Should have thrown')
    } catch (error) {
      // The error message contains /issues/ in the path, so classifyNotFoundError
      // matches the issue check first
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
    }
  })

  test('throws classified error on auth failure', async () => {
    mockFetchError(403)

    try {
      await removeYouTrackComment(config, {
        taskId: 'TEST-1',
        commentId: 'comment-1',
      })
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('auth-failed')
    }
  })
})
