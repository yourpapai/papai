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

/** Returns the set of hosts contributed by admin-scoped plugin config at call time.
 *
 * SECURITY RATIONALE: admin config is operator-trusted (same trust level as approving the
 * manifest). LLM/tool inputs can never influence this set — only an operator-level admin
 * can write admin config values. Dynamic hosts intentionally bypass the https requirement
 * and the public-IP (SSRF) check so that self-hosted LAN endpoints (often http://) work.
 * Static manifest hosts keep all existing checks. The thunk is evaluated lazily per
 * request so admin config changes apply without restart. */
export type DynamicHostsFn = () => ReadonlySet<string>

const noDynamicHosts: DynamicHostsFn = () => new Set()

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
// The same port-agnostic semantics apply to dynamic hosts: an admin's
// http://whisper.lan:9000 covers whisper.lan on any port.
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

function assertHttps(url: URL): void {
  if (url.protocol !== 'https:') {
    throw new Error('Plugin provider httpFetch requires an https URL')
  }
}

async function validateHop(
  url: URL,
  hostSet: ReadonlySet<string>,
  dynamicHosts: DynamicHostsFn,
  contextHosts: DynamicHostsFn,
  assertPublicUrl: (url: URL) => Promise<void>,
): Promise<void> {
  const host = url.hostname.toLowerCase()
  // Admin-sourced dynamic hosts are operator-trusted (same trust level as manifest approval).
  // They bypass both the https requirement and the public-IP check — deliberate,
  // to support self-hosted LAN endpoints that are commonly served over plain http.
  if (dynamicHosts().has(host)) return
  assertHttps(url)
  if (!hostSet.has(host) && !contextHosts().has(host)) {
    throw new Error(`Host '${url.hostname}' is not in the plugin providerAllowedHosts allowlist`)
  }
  await assertPublicUrl(url)
}

function getMethod(fetchInit: RequestInit): string {
  if (fetchInit.method === undefined || fetchInit.method === null) {
    return 'GET'
  }
  return fetchInit.method
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function stripRequestBodyHeaders(headers: HeadersInit | undefined): HeadersInit | undefined {
  if (headers === undefined) {
    return undefined
  }

  const nextHeaders = new Headers(headers)
  nextHeaders.delete('Content-Encoding')
  nextHeaders.delete('Content-Language')
  nextHeaders.delete('Content-Location')
  nextHeaders.delete('Content-Type')
  nextHeaders.delete('Content-Length')

  return nextHeaders
}

function stripAuthorizationHeader(headers: HeadersInit | undefined): HeadersInit | undefined {
  if (headers === undefined) {
    return undefined
  }

  const nextHeaders = new Headers(headers)
  nextHeaders.delete('Authorization')

  return nextHeaders
}

function isSameOrigin(fromUrl: URL, toUrl: URL): boolean {
  return fromUrl.origin === toUrl.origin
}

function buildRedirectFetchInit(fetchInit: RequestInit, status: number): RequestInit {
  const method = getMethod(fetchInit).toUpperCase()
  const shouldRewriteToGet =
    ((status === 301 || status === 302) && method === 'POST') ||
    (status === 303 && method !== 'GET' && method !== 'HEAD')

  if (!shouldRewriteToGet) {
    return fetchInit
  }

  const { body: _ignoredBody, headers, ...rest } = fetchInit
  return { ...rest, headers: stripRequestBodyHeaders(headers), method: 'GET' }
}

function sanitizeRedirectFetchInit(fetchInit: RequestInit, currentUrl: URL, redirectUrl: URL): RequestInit {
  if (isSameOrigin(currentUrl, redirectUrl)) {
    return fetchInit
  }

  return { ...fetchInit, headers: stripAuthorizationHeader(fetchInit.headers) }
}

async function fetchWithRedirects(
  currentUrl: URL,
  fetchInit: RequestInit,
  hostSet: ReadonlySet<string>,
  dynamicHosts: DynamicHostsFn,
  contextHosts: DynamicHostsFn,
  deps: ProviderRuntimeDeps,
  logger: PluginLogger,
  redirectsLeft: number,
): Promise<Response> {
  logger.debug({ host: currentUrl.hostname, method: getMethod(fetchInit) }, 'plugin provider httpFetch')
  const response = await deps.fetch(currentUrl.toString(), fetchInit)
  const isRedirect = isRedirectStatus(response.status)

  if (!isRedirect) {
    return response
  }

  if (redirectsLeft <= 0) {
    throw new Error('Too many redirects in plugin provider httpFetch')
  }

  const redirectUrl = resolveLocationUrl(response, currentUrl)
  // Redirect hops are validated against the static, admin-dynamic, and context host sets.
  // Admin-dynamic hosts still bypass https + public-IP checks on redirect hops — same
  // operator-trusted rationale as for the initial request.
  // Context hosts receive full standard validation on every hop (https + assertPublicUrl).
  await validateHop(redirectUrl, hostSet, dynamicHosts, contextHosts, deps.assertPublicUrl)

  // The caller's init (including any Authorization header) is forwarded to the
  // redirect target. This is acceptable because every hop must pass both the
  // allowlist check and assertPublicUrl (or be a trusted dynamic host), so headers
  // only ever reach hosts the plugin manifest already trusts.
  return fetchWithRedirects(
    redirectUrl,
    sanitizeRedirectFetchInit(buildRedirectFetchInit(fetchInit, response.status), currentUrl, redirectUrl),
    hostSet,
    dynamicHosts,
    contextHosts,
    deps,
    logger,
    redirectsLeft - 1,
  )
}

/**
 * Build a frozen PluginProviderRuntime that enforces two tiers of host allowlisting:
 *
 * - **Admin-sourced dynamic hosts** (`dynamicHosts`): operator-trusted (same trust level as
 *   manifest approval). These bypass the https requirement and the public-IP (SSRF) check,
 *   allowing self-hosted LAN endpoints that are commonly served over plain http.
 *
 * - **Context-sourced hosts** (`contextHosts`): user/group-scoped, NOT operator-trusted.
 *   These pass the allowlist membership check but receive full standard validation:
 *   https is required and assertPublicUrl (SSRF guard) is always enforced.
 *
 * Static manifest hosts (`allowedHosts`) also receive full standard validation.
 */
export function buildProviderRuntime(
  allowedHosts: readonly string[],
  logger: PluginLogger,
  deps: ProviderRuntimeDeps | undefined = defaultDeps,
  dynamicHosts: DynamicHostsFn = noDynamicHosts,
  contextHosts: DynamicHostsFn = noDynamicHosts,
): PluginProviderRuntime {
  const resolvedDeps = deps ?? defaultDeps

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
      await validateHop(url, hostSet, dynamicHosts, contextHosts, resolvedDeps.assertPublicUrl)

      const signal = composeSignal(init === undefined ? undefined : init.signal)
      const fetchInit = buildFetchInit(init, signal)

      return fetchWithRedirects(
        url,
        fetchInit,
        hostSet,
        dynamicHosts,
        contextHosts,
        resolvedDeps,
        logger,
        MAX_REDIRECTS,
      )
    },
  })
}
