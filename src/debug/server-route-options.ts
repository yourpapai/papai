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
