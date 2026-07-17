// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import type { DiscoveredPlugin } from './types.js'

type RetiredPluginDiscovery = Omit<DiscoveredPlugin, 'retired'>
type DiscoveryError = { directoryName: string; reason: string }

const retiredDiscoveries = new Map<string, DiscoveredPlugin>()
const log = logger.child({ scope: 'plugins:retired-discovery' })

/**
 * Registers a compatibility-only discovery record for a capability that moved
 * out of the sandboxed plugin lifecycle. The returned cleanup is ownership-safe
 * so replacing one runtime cannot remove another registration accidentally.
 */
export function registerRetiredPluginDiscovery(record: RetiredPluginDiscovery): () => void {
  const retiredRecord: DiscoveredPlugin = { ...record, retired: true }
  retiredDiscoveries.set(record.manifest.id, retiredRecord)
  return (): void => {
    if (retiredDiscoveries.get(record.manifest.id) === retiredRecord) {
      retiredDiscoveries.delete(record.manifest.id)
    }
  }
}

/** Compatibility records are deterministic and are never eligible for activation. */
function listRetiredPluginDiscoveries(): readonly DiscoveredPlugin[] {
  return Array.from(retiredDiscoveries.values()).sort((left, right) =>
    left.manifest.id.localeCompare(right.manifest.id),
  )
}

/** Merges compatibility records after filesystem discovery without masking real plugin ids. */
export function appendRetiredPluginDiscoveries(
  plugins: DiscoveredPlugin[],
  errors: DiscoveryError[],
  seenIds: Set<string>,
): void {
  for (const retired of listRetiredPluginDiscoveries()) {
    if (seenIds.has(retired.manifest.id)) {
      errors.push({
        directoryName: retired.manifest.id,
        reason: `Retired plugin discovery conflicts with filesystem plugin ID: ${retired.manifest.id}`,
      })
      continue
    }
    seenIds.add(retired.manifest.id)
    plugins.push(retired)
    log.info({ pluginId: retired.manifest.id }, 'Retired plugin compatibility record discovered')
  }
}
