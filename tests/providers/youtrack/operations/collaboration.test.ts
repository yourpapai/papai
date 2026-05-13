import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { SetTaskVisibilityParams } from '../../../../src/providers/types.js'
import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  addYouTrackCommentReaction,
  addYouTrackVote,
  addYouTrackWatcher,
  listYouTrackWatchers,
  removeYouTrackCommentReaction,
  removeYouTrackVote,
  removeYouTrackWatcher,
  setYouTrackVisibility,
} from '../../../../src/providers/youtrack/operations/collaboration.js'
import { mockLogger, restoreFetch } from '../../../utils/test-helpers.js'
import {
  type FetchMockFn,
  defaultConfig,
  getLastFetchBody,
  getLastFetchMethod,
  getLastFetchUrl,
  mockFetchError,
  mockFetchNoContent,
  mockFetchResponse,
} from '../fetch-mock-utils.js'

const fetchMock: { current?: FetchMockFn } = {}

const config: YouTrackConfig = defaultConfig

beforeEach(() => {
  mockLogger()
  fetchMock.current = undefined
})

afterEach(() => {
  restoreFetch()
})

describe('listYouTrackWatchers', () => {
  test('returns normalized watchers from issue watchers', async () => {
    mockFetchResponse(fetchMock, {
      id: 'issue-1',
      watchers: {
        hasStar: true,
        issueWatchers: [
          {
            isStarred: true,
            user: { id: 'user-1', login: 'alice', fullName: 'Alice Example', email: 'alice@example.com' },
          },
          {
            isStarred: false,
            user: { id: 'user-2', login: 'bob', fullName: 'Bob Example', email: 'bob@example.com' },
          },
        ],
      },
    })

    const watchers = await listYouTrackWatchers(config, 'TEST-1')

    expect(watchers).toEqual([
      { id: 'user-1', login: 'alice', name: 'Alice Example' },
      { id: 'user-2', login: 'bob', name: 'Bob Example' },
    ])
    expect(getLastFetchUrl(fetchMock.current).pathname).toBe('/api/issues/TEST-1')
    expect(getLastFetchMethod(fetchMock.current)).toBe('GET')
  })
})

describe('addYouTrackWatcher', () => {
  test('adds watcher by user id', async () => {
    mockFetchNoContent(fetchMock)

    const result = await addYouTrackWatcher(config, 'TEST-1', 'user-1')

    expect(result).toEqual({ taskId: 'TEST-1', userId: 'user-1' })
    expect(getLastFetchUrl(fetchMock.current).pathname).toBe('/api/issues/TEST-1/watchers/issueWatchers')
    expect(getLastFetchMethod(fetchMock.current)).toBe('POST')
    expect(getLastFetchBody(fetchMock.current)).toEqual({ user: { id: 'user-1' }, isStarred: true })
  })
})

describe('removeYouTrackWatcher', () => {
  test('removes watcher by user id', async () => {
    mockFetchNoContent(fetchMock)

    const result = await removeYouTrackWatcher(config, 'TEST-1', 'user-1')

    expect(result).toEqual({ taskId: 'TEST-1', userId: 'user-1' })
    expect(getLastFetchUrl(fetchMock.current).pathname).toBe('/api/issues/TEST-1/watchers/issueWatchers/user-1')
    expect(getLastFetchMethod(fetchMock.current)).toBe('DELETE')
  })
})

describe('addYouTrackVote', () => {
  test('adds vote via REST endpoint for task id', async () => {
    mockFetchNoContent(fetchMock)

    const result = await addYouTrackVote(config, 'TEST-1')

    expect(result).toEqual({ taskId: 'TEST-1' })
    expect(getLastFetchUrl(fetchMock.current).pathname).toBe('/api/issues/TEST-1/voters')
    expect(getLastFetchUrl(fetchMock.current).search).toBe('')
    expect(getLastFetchMethod(fetchMock.current)).toBe('POST')
    expect(getLastFetchBody(fetchMock.current)).toEqual({ hasVote: true })
  })
})

describe('removeYouTrackVote', () => {
  test('removes vote via REST endpoint for task id', async () => {
    mockFetchNoContent(fetchMock)

    const result = await removeYouTrackVote(config, 'TEST-1')

    expect(result).toEqual({ taskId: 'TEST-1' })
    expect(getLastFetchUrl(fetchMock.current).pathname).toBe('/api/issues/TEST-1/voters')
    expect(getLastFetchUrl(fetchMock.current).search).toBe('')
    expect(getLastFetchMethod(fetchMock.current)).toBe('DELETE')
  })
})

describe('setYouTrackVisibility', () => {
  test('sets restricted visibility and normalizes response', async () => {
    mockFetchResponse(fetchMock, {
      id: 'issue-1',
      visibility: {
        $type: 'LimitedVisibility',
        permittedUsers: [{ id: 'user-1', login: 'alice', fullName: 'Alice Example' }],
        permittedGroups: [{ id: 'group-1', name: 'Team Alpha' }],
      },
    })

    const result = await setYouTrackVisibility(config, 'TEST-1', {
      kind: 'restricted',
      userIds: ['user-1'],
      groupIds: ['group-1'],
    })

    expect(result).toEqual({
      taskId: 'TEST-1',
      visibility: {
        kind: 'restricted',
        users: [{ id: 'user-1', login: 'alice', name: 'Alice Example' }],
        groups: [{ id: 'group-1', name: 'Team Alpha' }],
      },
    })
    expect(getLastFetchUrl(fetchMock.current).pathname).toBe('/api/issues/TEST-1')
    expect(getLastFetchMethod(fetchMock.current)).toBe('POST')
    expect(getLastFetchBody(fetchMock.current)).toEqual({
      visibility: {
        $type: 'LimitedVisibility',
        permittedUsers: [{ id: 'user-1' }],
        permittedGroups: [{ id: 'group-1' }],
      },
    })
  })

  test('sets public visibility with unlimited payload', async () => {
    mockFetchResponse(fetchMock, {
      id: 'issue-1',
      visibility: { $type: 'UnlimitedVisibility' },
    })

    const result = await setYouTrackVisibility(config, 'TEST-1', { kind: 'public' })

    expect(result).toEqual({
      taskId: 'TEST-1',
      visibility: { kind: 'public' },
    })
    expect(getLastFetchBody(fetchMock.current)).toEqual({
      visibility: { $type: 'UnlimitedVisibility' },
    })
  })

  test('rejects restricted visibility without any audience targets before making an API call', async () => {
    const invalidParams: SetTaskVisibilityParams = { kind: 'restricted', userIds: ['user-1'] }
    invalidParams.userIds.pop()

    await expect(setYouTrackVisibility(config, 'TEST-1', invalidParams)).rejects.toBeInstanceOf(YouTrackClassifiedError)
    expect(fetchMock.current).toBeUndefined()
  })
})

describe('addYouTrackCommentReaction', () => {
  test('adds a comment reaction and preserves reaction id', async () => {
    mockFetchResponse(fetchMock, {
      id: 'reaction-1',
      reaction: 'thumbs_up',
      author: { id: 'user-1', login: 'alice', fullName: 'Alice Example', email: 'alice@example.com' },
    })

    const result = await addYouTrackCommentReaction(config, 'TEST-1', 'comment-1', 'thumbs_up')

    expect(result).toEqual({
      id: 'reaction-1',
      reaction: 'thumbs_up',
      author: { id: 'user-1', login: 'alice', name: 'Alice Example' },
      createdAt: undefined,
    })
    expect(getLastFetchUrl(fetchMock.current).pathname).toBe('/api/issues/TEST-1/comments/comment-1/reactions')
    expect(getLastFetchMethod(fetchMock.current)).toBe('POST')
    expect(getLastFetchBody(fetchMock.current)).toEqual({ reaction: 'thumbs_up' })
  })
})

describe('removeYouTrackCommentReaction', () => {
  test('removes a comment reaction by id', async () => {
    mockFetchNoContent(fetchMock)

    const result = await removeYouTrackCommentReaction(config, 'TEST-1', 'comment-1', 'reaction-1')

    expect(result).toEqual({ id: 'reaction-1', taskId: 'TEST-1', commentId: 'comment-1' })
    expect(getLastFetchUrl(fetchMock.current).pathname).toBe(
      '/api/issues/TEST-1/comments/comment-1/reactions/reaction-1',
    )
    expect(getLastFetchMethod(fetchMock.current)).toBe('DELETE')
  })

  test('classifies API failures', async () => {
    mockFetchError(fetchMock, 404, { error: 'Comment not found /comments/' })

    await expect(removeYouTrackCommentReaction(config, 'TEST-1', 'comment-1', 'reaction-1')).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })
})
