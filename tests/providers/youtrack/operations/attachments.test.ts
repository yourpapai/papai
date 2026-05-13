import { afterEach, describe, expect, mock, test } from 'bun:test'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  deleteYouTrackAttachment,
  listYouTrackAttachments,
  uploadYouTrackAttachment,
} from '../../../../src/providers/youtrack/operations/attachments.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'
import {
  type FetchMockFn,
  defaultConfig,
  getLastFetchMethod,
  getLastFetchUrl,
  installFetchMock,
  mockFetchError,
  mockFetchNoContent,
  mockFetchResponse,
} from '../fetch-mock-utils.js'

mockLogger()

const fetchMock: { current?: FetchMockFn } = {}

const config: YouTrackConfig = defaultConfig

const makeAttachmentResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '0-10',
  name: 'screenshot.png',
  mimeType: 'image/png',
  size: 2048,
  url: 'https://test.youtrack.cloud/api/files/0-10',
  thumbnailURL: 'https://test.youtrack.cloud/api/files/0-10?thumb',
  author: { login: 'bob' },
  created: 1700000000000,
  ...overrides,
})

afterEach(() => {
  restoreFetch()
  fetchMock.current = undefined
})

// --- listYouTrackAttachments ---

describe('listYouTrackAttachments', () => {
  test('returns mapped attachments from API', async () => {
    mockFetchResponse(fetchMock, [makeAttachmentResponse()])
    const result = await listYouTrackAttachments(config, 'PROJ-1')
    expect(result).toHaveLength(1)
    const att = result[0]
    expect(att?.id).toBe('0-10')
    expect(att?.name).toBe('screenshot.png')
    expect(att?.mimeType).toBe('image/png')
    expect(att?.size).toBe(2048)
    expect(att?.url).toBe('https://test.youtrack.cloud/api/files/0-10')
    expect(att?.thumbnailUrl).toBe('https://test.youtrack.cloud/api/files/0-10?thumb')
    expect(att?.author).toBe('bob')
    expect(att?.createdAt).toBe('2023-11-14T22:13:20.000Z')
  })

  test('returns empty array when no attachments', async () => {
    mockFetchResponse(fetchMock, [])
    const result = await listYouTrackAttachments(config, 'PROJ-1')
    expect(result).toHaveLength(0)
  })

  test('calls correct endpoint', async () => {
    mockFetchResponse(fetchMock, [])
    await listYouTrackAttachments(config, 'PROJ-42')
    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/issues/PROJ-42/attachments')
    expect(getLastFetchMethod(fetchMock.current)).toBe('GET')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(fetchMock, 404)
    await expect(listYouTrackAttachments(config, 'PROJ-99')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws classified error on 401', async () => {
    mockFetchError(fetchMock, 401)
    await expect(listYouTrackAttachments(config, 'PROJ-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

// --- uploadYouTrackAttachment ---

describe('uploadYouTrackAttachment', () => {
  test('uploads file and returns mapped attachment', async () => {
    mockFetchResponse(fetchMock, [
      makeAttachmentResponse({ id: '0-20', name: 'report.pdf', mimeType: 'application/pdf' }),
    ])
    const file = {
      name: 'report.pdf',
      content: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf',
    }
    const result = await uploadYouTrackAttachment(config, 'PROJ-1', file)
    expect(result.id).toBe('0-20')
    expect(result.name).toBe('report.pdf')
    expect(result.mimeType).toBe('application/pdf')
  })

  test('calls correct endpoint with POST', async () => {
    mockFetchResponse(fetchMock, [makeAttachmentResponse()])
    const file = { name: 'file.txt', content: new Uint8Array([72, 101, 108, 108, 111]) }
    await uploadYouTrackAttachment(config, 'PROJ-5', file)
    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/issues/PROJ-5/attachments')
    expect(getLastFetchMethod(fetchMock.current)).toBe('POST')
  })

  test('sends multipart form data', async () => {
    let capturedRequest: RequestInit | undefined
    installFetchMock(fetchMock, () => {
      return Promise.resolve(
        new Response(JSON.stringify([makeAttachmentResponse()]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    // Capture request init via a custom handler
    const m = mock<(url: string, init: RequestInit) => Promise<Response>>((_url, init) => {
      capturedRequest = init
      return Promise.resolve(
        new Response(JSON.stringify([makeAttachmentResponse()]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    setMockFetch((url: string, init: RequestInit) => m(url, init))

    const file = { name: 'data.csv', content: new Uint8Array([1, 2, 3]) }
    await uploadYouTrackAttachment(config, 'PROJ-1', file)
    expect(capturedRequest?.body).toBeInstanceOf(FormData)
  })

  test('throws classified error on 401', async () => {
    mockFetchError(fetchMock, 401)
    const file = { name: 'f.txt', content: new Uint8Array([]) }
    await expect(uploadYouTrackAttachment(config, 'PROJ-1', file)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws classified error on 400', async () => {
    mockFetchError(fetchMock, 400, { error: 'Bad Request' })
    const file = { name: 'f.txt', content: new Uint8Array([]) }
    await expect(uploadYouTrackAttachment(config, 'PROJ-1', file)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

// --- deleteYouTrackAttachment ---

describe('deleteYouTrackAttachment', () => {
  test('returns the deleted attachment id', async () => {
    mockFetchNoContent(fetchMock)
    const result = await deleteYouTrackAttachment(config, 'PROJ-1', '0-10')
    expect(result.id).toBe('0-10')
  })

  test('calls correct endpoint with DELETE', async () => {
    mockFetchNoContent(fetchMock)
    await deleteYouTrackAttachment(config, 'PROJ-3', '0-99')
    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/issues/PROJ-3/attachments/0-99')
    expect(getLastFetchMethod(fetchMock.current)).toBe('DELETE')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(fetchMock, 404)
    await expect(deleteYouTrackAttachment(config, 'PROJ-1', '0-999')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws classified error on 403', async () => {
    mockFetchError(fetchMock, 403)
    await expect(deleteYouTrackAttachment(config, 'PROJ-1', '0-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})
