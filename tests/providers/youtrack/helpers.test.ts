import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import {
  minutesToIso,
  paginate,
  parseDuration,
  resolveWorkItemTypeId,
} from '../../../src/providers/youtrack/helpers.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

mockLogger()

const config: YouTrackConfig = {
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
}

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>>

const installFetchMock = (handler: () => Promise<Response>): void => {
  const m = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMock = m
  setMockFetch((url: string, init: RequestInit) => m(url, init))
}

const mockFetchResponse = (data: unknown, status = 200): void => {
  installFetchMock(() =>
    Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

afterEach(() => {
  restoreFetch()
})

// --- parseDuration ---

describe('parseDuration', () => {
  test('parses "2h 30m" to PT2H30M', () => {
    expect(parseDuration('2h 30m')).toBe('PT2H30M')
  })

  test('parses "1.5h" to PT1H30M', () => {
    expect(parseDuration('1.5h')).toBe('PT1H30M')
  })

  test('parses "90m" to PT1H30M', () => {
    expect(parseDuration('90m')).toBe('PT1H30M')
  })

  test('parses "2h" to PT2H', () => {
    expect(parseDuration('2h')).toBe('PT2H')
  })

  test('parses "30m" to PT30M', () => {
    expect(parseDuration('30m')).toBe('PT30M')
  })

  test('parses "0.5h" to PT30M', () => {
    expect(parseDuration('0.5h')).toBe('PT30M')
  })

  test('passes through PT2H30M unchanged', () => {
    expect(parseDuration('PT2H30M')).toBe('PT2H30M')
  })

  test('passes through PT1H unchanged', () => {
    expect(parseDuration('PT1H')).toBe('PT1H')
  })

  test('passes through PT30M unchanged', () => {
    expect(parseDuration('PT30M')).toBe('PT30M')
  })

  test('parses "2h30m" without space', () => {
    expect(parseDuration('2h30m')).toBe('PT2H30M')
  })

  test('parses "60m" to PT1H', () => {
    expect(parseDuration('60m')).toBe('PT1H')
  })

  test('parses "120m" to PT2H', () => {
    expect(parseDuration('120m')).toBe('PT2H')
  })

  test('parses "45m" to PT45M', () => {
    expect(parseDuration('45m')).toBe('PT45M')
  })

  test('parses case-insensitively "2H 30M"', () => {
    expect(parseDuration('2H 30M')).toBe('PT2H30M')
  })

  test('rejects unsupported natural language', () => {
    expect(() => parseDuration('tomorrow afternoon')).toThrow('Unsupported duration format')
  })

  test('rejects invalid ISO duration', () => {
    expect(() => parseDuration('PT')).toThrow('Invalid ISO-8601 duration')
  })
})

// --- minutesToIso ---

describe('minutesToIso', () => {
  test('converts 90 minutes to PT1H30M', () => {
    expect(minutesToIso(90)).toBe('PT1H30M')
  })

  test('converts 60 minutes to PT1H', () => {
    expect(minutesToIso(60)).toBe('PT1H')
  })

  test('converts 30 minutes to PT30M', () => {
    expect(minutesToIso(30)).toBe('PT30M')
  })

  test('converts 120 minutes to PT2H', () => {
    expect(minutesToIso(120)).toBe('PT2H')
  })

  test('converts 0 minutes to PT0M', () => {
    expect(minutesToIso(0)).toBe('PT0M')
  })

  test('converts 150 minutes to PT2H30M', () => {
    expect(minutesToIso(150)).toBe('PT2H30M')
  })

  test('converts 1 minute to PT1M', () => {
    expect(minutesToIso(1)).toBe('PT1M')
  })
})

// --- paginate ---

describe('paginate', () => {
  const ItemSchema = z.object({ id: z.string(), name: z.string() })
  type Item = z.infer<typeof ItemSchema>

  test('returns items from a single page', async () => {
    const items: Item[] = [
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
    ]
    mockFetchResponse(items)
    const result = await paginate(config, '/api/items', {}, ItemSchema.array())
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('1')
  })

  test('paginates through multiple pages', async () => {
    const page1: Item[] = Array.from({ length: 5 }, (_, i) => ({ id: String(i), name: `item-${i}` }))
    const page2: Item[] = [{ id: '5', name: 'item-5' }]
    const responses = [
      new Response(JSON.stringify(page1), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      new Response(JSON.stringify(page2), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ]
    installFetchMock(() => Promise.resolve(responses.shift()!))
    const result = await paginate(config, '/api/items', {}, ItemSchema.array(), 10, 5)
    expect(result).toHaveLength(6)
  })

  test('stops at maxPages', async () => {
    const fullPage: Item[] = Array.from({ length: 5 }, (_, i) => ({ id: String(i), name: `item-${i}` }))
    let callCount = 0
    installFetchMock(() => {
      callCount++
      return Promise.resolve(
        new Response(JSON.stringify(fullPage), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })
    await paginate(config, '/api/items', {}, ItemSchema.array(), 2, 5)
    expect(callCount).toBe(2)
  })

  test('passes query params to the request', async () => {
    mockFetchResponse([])
    await paginate(config, '/api/items', { fields: 'id,name' }, ItemSchema.array())
    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.searchParams.get('fields')).toBe('id,name')
    expect(url.searchParams.get('$top')).toBe('100')
    expect(url.searchParams.get('$skip')).toBe('0')
  })

  test('returns empty array when API returns empty', async () => {
    mockFetchResponse([])
    const result = await paginate(config, '/api/items', {}, ItemSchema.array())
    expect(result).toHaveLength(0)
  })
})

// --- resolveWorkItemTypeId ---

describe('resolveWorkItemTypeId', () => {
  beforeEach(() => {
    restoreFetch()
  })

  test('returns matching type ID by name from global types', async () => {
    mockFetchResponse([
      { id: '5-0', name: 'Development' },
      { id: '5-1', name: 'Testing' },
    ])
    const id = await resolveWorkItemTypeId(config, 'Development')
    expect(id).toBe('5-0')
  })

  test('returns matching type ID by name from project types', async () => {
    mockFetchResponse([{ id: '5-2', name: 'Bug fixing' }])
    const id = await resolveWorkItemTypeId(config, 'Bug fixing', 'PROJECT-1')
    expect(id).toBe('5-2')
  })

  test('returns undefined when name not found', async () => {
    mockFetchResponse([{ id: '5-0', name: 'Development' }])
    const id = await resolveWorkItemTypeId(config, 'NonExistent')
    expect(id).toBeUndefined()
  })

  test('passes through matching type ID', async () => {
    mockFetchResponse([{ id: '5-1', name: 'Testing' }])
    const id = await resolveWorkItemTypeId(config, '5-1')
    expect(id).toBe('5-1')
  })

  test('is case-insensitive when matching names', async () => {
    mockFetchResponse([{ id: '5-1', name: 'Testing' }])
    const id = await resolveWorkItemTypeId(config, 'testing')
    expect(id).toBe('5-1')
  })

  test('propagates API errors', async () => {
    installFetchMock(() => Promise.resolve(new Response(null, { status: 500 })))
    await expect(resolveWorkItemTypeId(config, 'Development')).rejects.toThrow()
  })
})
