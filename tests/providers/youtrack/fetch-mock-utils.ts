import { mock } from 'bun:test'

import { z } from 'zod'

import { setMockFetch } from '../../utils/test-helpers.js'

export type FetchMockFn = ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>>

export const defaultConfig = {
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
}

export function installFetchMock(
  fetchMockRef: { current?: FetchMockFn },
  handler: (url: string, init: RequestInit) => Promise<Response>,
): void {
  const mocked = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMockRef.current = mocked
  setMockFetch((url: string, init: RequestInit) => mocked(url, init))
}

export function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export function mockFetchResponse(fetchMockRef: { current?: FetchMockFn }, data: unknown, status = 200): void {
  installFetchMock(fetchMockRef, () => Promise.resolve(createJsonResponse(data, status)))
}

export function mockFetchSequence(
  fetchMockRef: { current?: FetchMockFn },
  responses: Array<{ data: unknown; status?: number }>,
): void {
  let callIndex = 0
  installFetchMock(fetchMockRef, () => {
    const response = responses[callIndex]
    callIndex++
    if (response === undefined) {
      return Promise.resolve(createJsonResponse({}, 200))
    }
    if (response.status === 204) {
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    return Promise.resolve(createJsonResponse(response.data, response.status ?? 200))
  })
}

export function mockFetchNoContent(fetchMockRef: { current?: FetchMockFn }): void {
  installFetchMock(fetchMockRef, () => Promise.resolve(new Response(null, { status: 204 })))
}

export function mockFetchError(
  fetchMockRef: { current?: FetchMockFn },
  status: number,
  body: unknown = { error: 'Something went wrong' },
): void {
  installFetchMock(fetchMockRef, () => Promise.resolve(createJsonResponse(body, status)))
}

export const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.unknown().optional() }),
])

export const BodySchema = z.looseObject({})

export function getLastFetchUrl(fetchMock: FetchMockFn | undefined): URL {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls.at(-1))
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

function parseBody(body: unknown): z.infer<typeof BodySchema> {
  if (typeof body !== 'string') return {}
  return BodySchema.parse(JSON.parse(body))
}

export function getLastFetchBody(fetchMock: FetchMockFn | undefined): z.infer<typeof BodySchema> {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls.at(-1))
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return parseBody(body)
}

export function getLastFetchMethod(fetchMock: FetchMockFn | undefined): string {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls.at(-1))
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

export function getFetchUrlAt(fetchMock: FetchMockFn | undefined, index: number): URL {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[index])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

export function getFetchBodyAt(fetchMock: FetchMockFn | undefined, index: number): z.infer<typeof BodySchema> {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[index])
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return parseBody(body)
}

export function getFetchMethodAt(fetchMock: FetchMockFn | undefined, index: number): string {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[index])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}
