// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveApiBaseUrl } from './client.js'

/**
 * Web root derived from the API base: `api.github.com` → github.com; any
 * other host (GHES) → the baseUrl origin (subpath prefixes like /api/v3 are
 * not part of the web UI path).
 */
export const resolveWebBaseUrl = (baseUrl: string): string => {
  const resolved = new URL(resolveApiBaseUrl(baseUrl))
  if (resolved.host === 'api.github.com') return 'https://github.com'
  return resolved.origin
}

export const buildGitHubTaskUrl = (baseUrl: string, repo: string, taskNumber: string): string =>
  `${resolveWebBaseUrl(baseUrl)}/${repo}/issues/${taskNumber}`

export const buildGitHubProjectUrl = (baseUrl: string, repo: string): string => `${resolveWebBaseUrl(baseUrl)}/${repo}`
