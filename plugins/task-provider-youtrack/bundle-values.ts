// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../src/logger.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { BundleElementListSchema } from './schemas/bundle.js'

const log = logger.child({ scope: 'youtrack:bundle-values' })

export interface BundleElement {
  name: string
  localizedName?: string
}

export type BundleElementFetcher = (segment: string, bundleId: string) => Promise<BundleElement[]>

const BUNDLE_ELEMENT_FIELDS = 'name,localizedName,ordinal'
const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  elements: BundleElement[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

const cacheKey = (config: Readonly<YouTrackConfig>, segment: string, bundleId: string): string =>
  `${config.baseUrl}|${segment}|${bundleId}`

export const makeBundleElementFetcher = (config: Readonly<YouTrackConfig>): BundleElementFetcher => {
  return async (segment: string, bundleId: string): Promise<BundleElement[]> => {
    const key = cacheKey(config, segment, bundleId)
    const cached = cache.get(key)
    if (cached !== undefined && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      log.debug({ segment, bundleId }, 'bundle element cache hit')
      return cached.elements
    }
    const raw = await youtrackFetch(
      config,
      'GET',
      `/api/admin/customFieldSettings/bundles/${segment}/${bundleId}/values`,
      { query: { fields: BUNDLE_ELEMENT_FIELDS } },
    )
    const elements = BundleElementListSchema.parse(raw).map((e) => ({
      name: e.name,
      localizedName: e.localizedName ?? undefined,
    }))
    cache.set(key, { elements, fetchedAt: Date.now() })
    log.debug({ segment, bundleId, count: elements.length }, 'bundle elements fetched')
    return elements
  }
}
