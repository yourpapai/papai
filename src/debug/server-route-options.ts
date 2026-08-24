// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ProviderRuntimeDeps } from '../plugins/provider-runtime.js'

const DEBUG_ONLY_PATHS = new Set([
  '/debug',
  '/debug.js',
  '/debug.css',
  '/events',
  '/logs',
  '/logs/stats',
  '/logs/scopes',
  '/dashboard',
])

export const isDebugOnlyPath = (pathname: string): boolean =>
  DEBUG_ONLY_PATHS.has(pathname) || pathname.startsWith('/turns/')

export type WebServerRouteOptions = Readonly<{
  debugEnabled: boolean
  mattermostActionSecretForTest?: string
  nowMs?: number
  pluginProviderRuntimeDeps?: ProviderRuntimeDeps
}>

export type WebServerStartOptions = Readonly<{
  debugEnabled?: boolean
  /** No longer affects the log buffer — the buffer stream attaches at logger module load. */
  logLevel?: string
  pluginProviderRuntimeDeps?: ProviderRuntimeDeps
}>

export type ResolvedWebServerStartOptions = Readonly<{
  debugEnabled: boolean
  logLevel: string
  pluginProviderRuntimeDeps?: ProviderRuntimeDeps
}>

export const resolveWebServerStartOptions = (
  options: WebServerStartOptions | string | undefined,
  defaultLogLevel: string,
): ResolvedWebServerStartOptions =>
  typeof options === 'string'
    ? { debugEnabled: true, logLevel: options }
    : {
        debugEnabled: options?.debugEnabled ?? true,
        logLevel: options?.logLevel ?? defaultLogLevel,
        pluginProviderRuntimeDeps: options?.pluginProviderRuntimeDeps,
      }

export const DEFAULT_WEB_SERVER_ROUTE_OPTIONS = { debugEnabled: true } as const satisfies WebServerRouteOptions

/**
 * Static snapshot of HTTP pathnames served by the debug/settings web server.
 *
 * Routing is dispatched across several helpers (`routeProtectedPaths`,
 * `routeAdminPaths`, `routeSettingsRequest`, `routePublicAuthPaths`, etc.) and
 * several paths are prefix-based rather than literal. This list is curated to
 * the major path identifiers the behavior-audit closure verifier expects to
 * recognize in LLM-provided entry-point hints; it is not exhaustive. New
 * top-level routes should be appended here so the closure check keeps
 * recognizing them.
 *
 * Scope: literal pathnames only (no query strings, no method qualifiers, no
 * trailing `/<id>` capture suffixes). Prefix routes (e.g. `/turns/<id>`,
 * `/billing/subject/<id>`) are represented by their stem if the LLM is likely
 * to mention that stem; otherwise omitted.
 */
export const BUILTIN_HTTP_ROUTES: readonly string[] = Object.freeze([
  // SSE + log surface
  '/events',
  '/logs',
  '/logs/stats',
  '/logs/scopes',
  // Operator turn inspector (prefix /turns/<id>)
  '/turns/',
  // Live data surfaces (admin-gated)
  '/recurring',
  '/deferred',
  '/memos',
  '/identity',
  // MCP status
  '/mcp/status',
  // Dashboard redirect
  '/dashboard',
  // Billing & stats
  '/billing/subjects',
  '/billing/subject/',
  '/stats/global',
  '/stats/subject/',
  // Admin surface
  '/admin/identity/mappings',
  '/admin/subjects/',
  // Notify hook (mattermost / external)
  '/api/notify',
  // Operator / admin / settings SPA shells and asset variants
  '/debug',
  '/debug.js',
  '/debug.css',
  '/admin',
  '/admin.js',
  '/admin.css',
  '/settings',
  '/settings.js',
  '/settings.css',
  // Settings auth + bootstrap API
  '/settings/auth/exchange',
  '/settings/auth/logout',
  '/settings/api/session',
  '/settings/api/bootstrap',
  // Major settings API surfaces (stems only; not exhaustive)
  '/settings/api/',
])

/**
 * Returns the curated `BUILTIN_HTTP_ROUTES` list for the behavior-audit closure
 * verifier. The set is static by design; dynamic routes (e.g. per-plugin MCP
 * subpaths) are not enumerated.
 */
export function listRoutes(): readonly string[] {
  return BUILTIN_HTTP_ROUTES
}
