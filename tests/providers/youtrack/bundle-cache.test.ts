import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

import { resolveStateBundle } from '../../../src/providers/youtrack/bundle-cache.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'
import { clearBundleCache } from './test-helpers.js'

// ---------------------------------------------------------------------------
// Reusable fetch-response builders (defined outside test blocks)
// ---------------------------------------------------------------------------

function makeCustomFieldsResponse(bundleId: string, bundleType?: string): Response {
  return new Response(
    JSON.stringify([
      {
        $type: 'StateProjectCustomField',
        field: { name: 'State' },
        bundle: bundleType === undefined ? { id: bundleId } : { id: bundleId, $type: bundleType },
      },
    ]),
    { status: 200 },
  )
}

function makeBundleResponse(bundleId: string, projectIds: string[]): Response {
  return new Response(
    JSON.stringify({
      id: bundleId,
      aggregated: { project: projectIds.map((id) => ({ id })) },
    }),
    { status: 200 },
  )
}

function makeErrorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: 'Not found' }), { status })
}

function makeUnknownUrlResponse(): Response {
  return new Response(JSON.stringify({ error: 'Unknown URL' }), { status: 404 })
}

// ---------------------------------------------------------------------------
// Sequence-based mock: first call returns customFields, second returns bundle
// ---------------------------------------------------------------------------

function makeSequencedFetch(
  counters: { count: number },
  customFieldsBundleId: string,
  bundleBundleId: string,
  projectIds: string[],
): (url: string) => Promise<Response> {
  return (_url: string): Promise<Response> => {
    counters.count++
    if (counters.count === 1) {
      return Promise.resolve(makeCustomFieldsResponse(customFieldsBundleId))
    }
    return Promise.resolve(makeBundleResponse(bundleBundleId, projectIds))
  }
}

// ---------------------------------------------------------------------------
// URL-routing-based mock: routes /customFields vs bundle endpoint
// ---------------------------------------------------------------------------

function makeRoutedFetch(
  counter: { count: number },
  customFieldsBundleId: string,
  bundleBundleId: string,
  projectIds: string[],
): (url: string) => Promise<Response> {
  return (url: string): Promise<Response> => {
    counter.count++
    if (url.includes('/customFields')) {
      return Promise.resolve(makeCustomFieldsResponse(customFieldsBundleId))
    }
    return Promise.resolve(makeBundleResponse(bundleBundleId, projectIds))
  }
}

// ---------------------------------------------------------------------------
// Multi-instance routing: routes by host substring
// ---------------------------------------------------------------------------

function makeMultiInstanceFetch(
  countersA: { count: number },
  countersB: { count: number },
  bundleIdA: string,
  projectIdsA: string[],
  bundleIdB: string,
  projectIdsB: string[],
): (url: string) => Promise<Response> {
  return (url: string): Promise<Response> => {
    if (url.includes('company-a')) {
      countersA.count++
      if (url.includes('/customFields')) {
        return Promise.resolve(makeCustomFieldsResponse(bundleIdA))
      }
      return Promise.resolve(makeBundleResponse(bundleIdA, projectIdsA))
    }
    if (url.includes('company-b')) {
      countersB.count++
      if (url.includes('/customFields')) {
        return Promise.resolve(makeCustomFieldsResponse(bundleIdB))
      }
      return Promise.resolve(makeBundleResponse(bundleIdB, projectIdsB))
    }
    return Promise.resolve(makeUnknownUrlResponse())
  }
}

// ---------------------------------------------------------------------------

describe('bundle-cache', () => {
  const config = { baseUrl: 'https://example.com', token: 'test-token' }

  beforeEach(() => {
    restoreFetch()
    clearBundleCache()
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('resolveStateBundle', () => {
    test('fetches and caches bundle info', async () => {
      const counters = { count: 0 }
      setMockFetch(makeSequencedFetch(counters, 'bundle-123', 'bundle-123', ['proj-1', 'proj-2']))

      const result = await resolveStateBundle(config, 'proj-1')

      expect(result).toEqual({ bundleId: 'bundle-123', isShared: true })
    })

    test('returns null when State field not found', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))

      const result = await resolveStateBundle(config, 'proj-1')

      expect(result).toBeNull()
    })

    test('caches successful result', async () => {
      const counter = { count: 0 }
      setMockFetch(makeRoutedFetch(counter, 'bundle-123', 'bundle-123', ['proj-1']))

      await resolveStateBundle(config, 'proj-1')
      await resolveStateBundle(config, 'proj-1')

      expect(counter.count).toBe(2)
    })

    test('determines bundle is not shared when single project', async () => {
      const counters = { count: 0 }
      setMockFetch(makeSequencedFetch(counters, 'bundle-456', 'bundle-456', ['proj-1']))

      const result = await resolveStateBundle(config, 'proj-1')

      expect(result).toEqual({ bundleId: 'bundle-456', isShared: false })
    })

    test('caches failures with shorter TTL', async () => {
      let fetchCount = 0
      setMockFetch(() => {
        fetchCount++
        return Promise.resolve(makeErrorResponse(404))
      })

      await resolveStateBundle(config, 'proj-1')
      await resolveStateBundle(config, 'proj-1')

      expect(fetchCount).toBe(1)
    })
  })

  describe('TTL expiration', () => {
    test('success cache expires after TTL', async () => {
      const originalDateNow = Date.now
      let currentTime = 1000000
      Date.now = (): number => currentTime

      const counter = { count: 0 }
      setMockFetch(makeRoutedFetch(counter, 'bundle-123', 'bundle-123', ['proj-1']))

      await resolveStateBundle(config, 'proj-1')
      expect(counter.count).toBe(2)

      await resolveStateBundle(config, 'proj-1')
      expect(counter.count).toBe(2)

      currentTime += 5 * 60 * 1000
      await resolveStateBundle(config, 'proj-1')
      expect(counter.count).toBe(4)

      Date.now = originalDateNow
    })

    test('failure cache expires after TTL', async () => {
      const originalDateNow = Date.now
      let currentTime = 1000000
      Date.now = (): number => currentTime

      let fetchCount = 0
      setMockFetch(() => {
        fetchCount++
        return Promise.resolve(makeErrorResponse(404))
      })

      await resolveStateBundle(config, 'proj-1')
      expect(fetchCount).toBe(1)

      await resolveStateBundle(config, 'proj-1')
      expect(fetchCount).toBe(1)

      currentTime += 30 * 1000
      await resolveStateBundle(config, 'proj-1')
      expect(fetchCount).toBe(2)

      Date.now = originalDateNow
    })
  })

  describe('clearBundleCache', () => {
    test('clears all cached entries', async () => {
      const counter = { count: 0 }
      setMockFetch(makeRoutedFetch(counter, 'bundle-789', 'bundle-789', ['proj-1']))

      await resolveStateBundle(config, 'proj-1')
      clearBundleCache()
      await resolveStateBundle(config, 'proj-1')

      expect(counter.count).toBe(4)
    })
  })

  describe('multi-instance isolation', () => {
    test('does not share cache between different YouTrack instances', async () => {
      const configA = { baseUrl: 'https://company-a.youtrack.cloud', token: 'token-a' }
      const configB = { baseUrl: 'https://company-b.youtrack.cloud', token: 'token-b' }

      const countersA = { count: 0 }
      const countersB = { count: 0 }

      setMockFetch(
        makeMultiInstanceFetch(countersA, countersB, 'bundle-from-a', ['proj-1'], 'bundle-from-b', ['proj-1']),
      )

      const resultA = await resolveStateBundle(configA, 'proj-1')
      const resultB = await resolveStateBundle(configB, 'proj-1')

      // Each instance should have fetched their own bundle
      expect(resultA).toEqual({ bundleId: 'bundle-from-a', isShared: false })
      expect(resultB).toEqual({ bundleId: 'bundle-from-b', isShared: false })
      expect(countersA.count).toBe(2)
      expect(countersB.count).toBe(2)
    })

    test('caches are isolated per YouTrack instance', async () => {
      const configA = { baseUrl: 'https://company-a.youtrack.cloud', token: 'token-a' }
      const configB = { baseUrl: 'https://company-b.youtrack.cloud', token: 'token-b' }

      const countersA = { count: 0 }
      const countersB = { count: 0 }

      setMockFetch(
        makeMultiInstanceFetch(countersA, countersB, 'bundle-a', ['shared-proj'], 'bundle-b', ['shared-proj']),
      )

      // First call from instance A - should fetch
      await resolveStateBundle(configA, 'shared-proj')
      expect(countersA.count).toBe(2)

      // Second call from instance A - should use cache (no new fetch)
      await resolveStateBundle(configA, 'shared-proj')
      expect(countersA.count).toBe(2)

      // Call from instance B with same projectId - should fetch, not use A's cache
      await resolveStateBundle(configB, 'shared-proj')
      expect(countersB.count).toBe(2)

      // Second call from instance B - should use cache
      await resolveStateBundle(configB, 'shared-proj')
      expect(countersB.count).toBe(2)

      // Verify A's cache still works
      await resolveStateBundle(configA, 'shared-proj')
      expect(countersA.count).toBe(2)
    })
  })
})
