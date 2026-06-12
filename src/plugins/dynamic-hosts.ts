// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import type { DynamicHostsFn } from './provider-runtime.js'
import { getPluginAdminConfig } from './store.js'
import type { PluginManifest } from './types.js'

const log = logger.child({ scope: 'plugins:dynamic-hosts' })

/** Build a thunk that reads admin-scoped plugin config at call time and resolves the
 * declared host keys to a set of hostnames.
 *
 * SECURITY RATIONALE: admin config values are operator-trusted (same trust level as
 * manifest approval). The thunk is evaluated lazily on every httpFetch call so that
 * config changes take effect without a process restart. LLM/tool inputs cannot influence
 * this set — only an operator-level admin can write admin config. Non-URL values and
 * blank strings are silently skipped; the resulting hosts bypass https + public-IP
 * checks in validateHop (deliberate, to support self-hosted LAN endpoints). */
export function buildDynamicHosts(manifest: PluginManifest): DynamicHostsFn {
  const keys = manifest.providerAllowedHostsFromConfig ?? []
  return (): ReadonlySet<string> => {
    const hosts = new Set<string>()
    for (const key of keys) {
      const value = getPluginAdminConfig(manifest.id, key)
      if (value === undefined || value.trim() === '') continue
      try {
        hosts.add(new URL(value).hostname.toLowerCase())
      } catch {
        log.warn({ pluginId: manifest.id, key }, 'providerAllowedHostsFromConfig value is not a valid URL; skipping')
      }
    }
    return hosts
  }
}
