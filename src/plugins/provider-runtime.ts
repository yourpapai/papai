// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { assertPublicUrl as defaultAssertPublicUrl } from '../web/safe-fetch.js'
import type { PluginLogger } from './context.js'

export type PluginProviderRuntime = {
  readonly httpFetch: (url: string, init?: RequestInit) => Promise<Response>
  readonly allowedHosts: ReadonlySet<string>
  readonly logger: PluginLogger
}

export interface ProviderRuntimeDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  assertPublicUrl: (url: URL) => Promise<void>
}

const defaultDeps: ProviderRuntimeDeps = {
  fetch,
  assertPublicUrl: defaultAssertPublicUrl,
}

export function buildProviderRuntime(
  allowedHosts: readonly string[],
  logger: PluginLogger,
  deps: ProviderRuntimeDeps = defaultDeps,
): PluginProviderRuntime {
  const hostSet: ReadonlySet<string> = new Set(allowedHosts.map((h) => h.toLowerCase()))

  return Object.freeze({
    allowedHosts: hostSet,
    logger,
    async httpFetch(rawUrl: string, init?: RequestInit): Promise<Response> {
      const url = new URL(rawUrl)
      if (!hostSet.has(url.hostname.toLowerCase())) {
        throw new Error(`Host '${url.hostname}' is not in the plugin providerAllowedHosts allowlist`)
      }
      await deps.assertPublicUrl(url)
      return deps.fetch(url.toString(), init)
    },
  })
}
