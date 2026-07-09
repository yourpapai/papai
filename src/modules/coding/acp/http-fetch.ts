// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../../logger.js'
import { buildPluginLogger } from '../../../plugins/context-facade-builders.js'
import { buildProviderRuntime, type DynamicHostsFn } from '../../../plugins/provider-runtime.js'
import { getPluginAdminConfig } from '../../../plugins/store.js'

const log = logger.child({ scope: 'modules:coding:acp:http' })

/**
 * Hosts contributed by the operator-configured magi base URL. Host-only and port-agnostic
 * (matching the plugin loader's `buildDynamicHosts`). Evaluated lazily per request so an admin
 * changing `magi_base_url` applies without a restart. Admin config is operator-trusted, so these
 * hosts intentionally bypass the https + public-IP checks in the provider runtime.
 */
export const magiDynamicHosts: DynamicHostsFn = (): ReadonlySet<string> => {
  const hosts = new Set<string>()
  const value = getPluginAdminConfig('acp', 'magi_base_url')
  if (value !== undefined && value.trim() !== '') {
    try {
      hosts.add(new URL(value).hostname.toLowerCase())
    } catch {
      log.warn({ key: 'magi_base_url' }, 'magi_base_url is not a valid URL; skipping allowlist entry')
    }
  }
  return hosts
}

/** The magi HTTP client used by every acp tool. Built once; the dynamic-hosts thunk is live. */
export const magiHttpFetch = buildProviderRuntime(
  [],
  buildPluginLogger('coding'),
  undefined,
  magiDynamicHosts,
).httpFetch
