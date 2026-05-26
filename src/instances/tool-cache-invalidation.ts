// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { clearCachedToolsByPrefix } from '../cache.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'instances:tool-cache-invalidation' })

export const clearToolCachesForContexts = (contextIds: readonly string[]): void => {
  const uniqueContextIds = [...new Set(contextIds)]
  for (const contextId of uniqueContextIds) clearCachedToolsByPrefix(contextId)
  if (uniqueContextIds.length > 0) {
    log.info({ contextCount: uniqueContextIds.length }, 'cleared tool caches for contexts')
  }
}
