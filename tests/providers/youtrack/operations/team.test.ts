import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  addYouTrackProjectMember,
  listYouTrackProjectTeam,
  removeYouTrackProjectMember,
} from '../../../../src/providers/youtrack/operations/team.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>>

const config: YouTrackConfig = {
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
}

const installFetchMock = (handler: () => Promise<Response>): void => {
  const m = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMock = m
  setMockFetch((url: string, init: RequestInit) => m(url, init))
}

const mockFetchSequence = (responses: Array<{ data: unknown; status?: number }>): void => {
  let callIndex = 0
  installFetchMock(() => {
    const response = responses[callIndex]
    callIndex++
    if (response === undefined) {
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    }
    if ((response.status ?? 200) === 204) {
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    return Promise.resolve(
      new Response(JSON.stringify(response.data), {
        status: response.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

const mockFetchError = (status: number, body: unknown = { error: 'Something went wrong' }): void => {
  installFetchMock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const BodySchema = z.object({ id: z.string() })

const getFetchUrlAt = (index: number): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getFetchMethodAt = (index: number): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

const getFetchBodyAt = (index: number): z.infer<typeof BodySchema> | undefined => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return undefined
  const { body } = parsed.data[1]
  if (body === undefined) return undefined
  return BodySchema.parse(JSON.parse(body))
}

const makeProject = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'proj-1',
  ringId: 'project-ring-1',
  shortName: 'PROJ',
  name: 'Project One',
  $type: 'Project',
  ...overrides,
})

const makeUser = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'user-1',
  login: 'alice',
  name: 'Alice Example',
  fullName: 'Alice Example',
  email: 'alice@example.com',
  ringId: 'ring-user-1',
  $type: 'User',
  ...overrides,
})

const makeTeamUser = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ring-user-1',
  login: 'alice',
  name: 'Alice Example',
  type: 'user',
  ...overrides,
})

describe('listYouTrackProjectTeam', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('lists mapped team members from the project team endpoint', async () => {
    mockFetchSequence([
      { data: makeProject() },
      { data: [makeTeamUser(), makeTeamUser({ id: 'ring-user-2', login: 'bob', name: 'Bob Example' })] },
    ])

    const team = await listYouTrackProjectTeam(config, 'proj-1')

    expect(team).toEqual([
      { id: 'ring-user-1', login: 'alice', name: 'Alice Example' },
      { id: 'ring-user-2', login: 'bob', name: 'Bob Example' },
    ])

    expect(getFetchUrlAt(0).pathname).toBe('/api/admin/projects/proj-1')
    expect(getFetchUrlAt(0).searchParams.get('fields')).toBe('id,ringId,shortName,name')
    expect(getFetchMethodAt(0)).toBe('GET')

    const teamUrl = getFetchUrlAt(1)
    expect(teamUrl.pathname).toBe('/hub/api/rest/projects/project-ring-1/team/users')
    expect(teamUrl.searchParams.get('fields')).toBe('id,login,name')
    expect(teamUrl.searchParams.get('$top')).toBe('100')
    expect(getFetchMethodAt(1)).toBe('GET')
  })

  test('paginates through team members', async () => {
    const page1Users = Array.from({ length: 100 }, (_, index) =>
      makeTeamUser({
        id: `ring-user-${index + 1}`,
        login: `user${index + 1}`,
        name: `User ${index + 1}`,
      }),
    )
    const page2Users = [makeTeamUser({ id: 'ring-user-101', login: 'user101', name: 'User 101' })]

    mockFetchSequence([{ data: makeProject() }, { data: page1Users }, { data: page2Users }])

    const team = await listYouTrackProjectTeam(config, 'proj-1')

    expect(team).toHaveLength(101)
    expect(getFetchUrlAt(1).searchParams.get('$skip')).toBe('0')
    expect(getFetchUrlAt(2).searchParams.get('$skip')).toBe('100')
  })

  test('throws classified error on API failure', async () => {
    mockFetchError(404, { error: 'Project not found' })

    await expect(listYouTrackProjectTeam(config, 'proj-404')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('addYouTrackProjectMember', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('adds a project member using the team users endpoint', async () => {
    mockFetchSequence([
      { data: makeProject() },
      { data: makeUser({ id: 'user-7', login: 'user7', ringId: 'ring-user-7', name: 'User 7', fullName: 'User 7' }) },
      { data: null, status: 204 },
    ])

    const result = await addYouTrackProjectMember(config, 'proj-1', 'user-7')

    expect(result).toEqual({ projectId: 'proj-1', userId: 'user-7' })

    expect(getFetchUrlAt(0).pathname).toBe('/api/admin/projects/proj-1')
    expect(getFetchUrlAt(1).pathname).toBe('/api/users/user-7')

    const url = getFetchUrlAt(2)
    expect(url.pathname).toBe('/hub/api/rest/projects/project-ring-1/team/users')
    expect(getFetchMethodAt(2)).toBe('POST')
    expect(getFetchBodyAt(2)).toEqual({ id: 'ring-user-7' })
  })

  test('throws classified error on auth failure', async () => {
    mockFetchError(403)

    await expect(addYouTrackProjectMember(config, 'proj-1', 'user-7')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('removeYouTrackProjectMember', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('removes a project member using the team member endpoint', async () => {
    mockFetchSequence([
      { data: makeProject() },
      { data: makeUser({ id: 'user-7', login: 'user7', ringId: 'ring-user-7', name: 'User 7', fullName: 'User 7' }) },
      { data: null, status: 204 },
    ])

    const result = await removeYouTrackProjectMember(config, 'proj-1', 'user-7')

    expect(result).toEqual({ projectId: 'proj-1', userId: 'user-7' })

    expect(getFetchUrlAt(0).pathname).toBe('/api/admin/projects/proj-1')
    expect(getFetchUrlAt(1).pathname).toBe('/api/users/user-7')

    const url = getFetchUrlAt(2)
    expect(url.pathname).toBe('/hub/api/rest/projects/project-ring-1/team/users/ring-user-7')
    expect(getFetchMethodAt(2)).toBe('DELETE')
  })

  test('throws classified error on not found', async () => {
    mockFetchError(404, { error: 'Project not found' })

    await expect(removeYouTrackProjectMember(config, 'proj-404', 'user-7')).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })
})
