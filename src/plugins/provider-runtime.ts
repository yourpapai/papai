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

// The allowlist is host-only by design: ports are intentionally not part of
// the allowlist scope. Plugin manifests declare plain hostnames (no colons
// allowed by pluginManifestSchema), so port-level restriction is not supported.
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 30_000

function parseProviderUrl(rawUrl: string): URL {
  try {
    return new URL(rawUrl)
  } catch {
    throw new Error('Invalid provider httpFetch URL')
  }
}

function composeSignal(callerSignal: AbortSignal | null | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  if (callerSignal === undefined || callerSignal === null) {
    return timeout
  }
  return AbortSignal.any([callerSignal, timeout])
}

function buildFetchInit(callerInit: RequestInit | undefined, signal: AbortSignal): RequestInit {
  if (callerInit === undefined) {
    return { redirect: 'manual', signal }
  }
  const { signal: _ignored, ...rest } = callerInit
  return { ...rest, redirect: 'manual', signal }
}

function resolveLocationUrl(response: Response, currentUrl: URL): URL {
  const location = response.headers.get('location')
  if (location === null) {
    throw new Error('Redirect response missing location header')
  }
  try {
    return new URL(location, currentUrl)
  } catch {
    throw new Error('Redirect location was invalid')
  }
}

async function validateHop(
  url: URL,
  hostSet: ReadonlySet<string>,
  assertPublicUrl: (url: URL) => Promise<void>,
): Promise<void> {
  if (!hostSet.has(url.hostname.toLowerCase())) {
    throw new Error(`Host ${url.hostname} is not allowed`)
  }
  await assertPublicUrl(url)
}

function getMethod(fetchInit: RequestInit): string {
  if (fetchInit.method === undefined || fetchInit.method === null) {
    return 'GET'
  }
  return fetchInit.method
}

async function fetchWithRedirects(
  currentUrl: URL,
  fetchInit: RequestInit,
  hostSet: ReadonlySet<string>,
  deps: ProviderRuntimeDeps,
  logger: PluginLogger,
  redirectsLeft: number,
): Promise<Response> {
  logger.debug({ host: currentUrl.hostname, method: getMethod(fetchInit) }, 'plugin provider httpFetch')
  const response = await deps.fetch(currentUrl.toString(), fetchInit)
  const isRedirect = response.status >= 300 && response.status < 400

  if (!isRedirect) {
    return response
  }

  if (redirectsLeft <= 0) {
    throw new Error('Too many redirects in plugin provider httpFetch')
  }

  const redirectUrl = resolveLocationUrl(response, currentUrl)
  await validateHop(redirectUrl, hostSet, deps.assertPublicUrl)

  // The caller's init (including any Authorization header) is forwarded to the
  // redirect target. This is acceptable because every hop must pass both the
  // allowlist check and assertPublicUrl, so headers only ever reach hosts the
  // plugin manifest already trusts.
  return fetchWithRedirects(redirectUrl, fetchInit, hostSet, deps, logger, redirectsLeft - 1)
}

export function buildProviderRuntime(
  allowedHosts: readonly string[],
  logger: PluginLogger,
  deps: ProviderRuntimeDeps = defaultDeps,
): PluginProviderRuntime {
  // Private enforcement set. Never exposed directly; httpFetch closes over this
  // copy, so mutations to the exposed Set cannot affect enforcement.
  const hostSet: ReadonlySet<string> = new Set(allowedHosts.map((h) => h.toLowerCase()))

  // This is a diagnostic copy, not a security boundary. Object.freeze() does not
  // make Set entries immutable; security comes from the private hostSet above.
  const exposedHosts: ReadonlySet<string> = Object.freeze(new Set(hostSet))

  return Object.freeze({
    allowedHosts: exposedHosts,
    logger,
    async httpFetch(rawUrl: string, init?: RequestInit): Promise<Response> {
      const url = parseProviderUrl(rawUrl)
      await validateHop(url, hostSet, deps.assertPublicUrl)

      const signal = composeSignal(init === undefined ? undefined : init.signal)
      const fetchInit = buildFetchInit(init, signal)

      return fetchWithRedirects(url, fetchInit, hostSet, deps, logger, MAX_REDIRECTS)
    },
  })
}
