// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveApiBaseUrl } from './client.js'
import { GITHUB_DEFAULT_BASE_URL } from './constants.js'

const GHES_REST_SUFFIX = '/api/v3'

/**
 * Resolves the GraphQL endpoint from the configured REST base, composing on
 * `resolveApiBaseUrl`'s output (empty → public default, trailing slashes
 * stripped): the public REST base appends `/graphql`, a GHES `/api/v3`
 * suffix is replaced by the same origin's `/api/graphql` (sub-path prefixes
 * survive), and any other base (GHES bare origin) appends `/api/graphql`.
 */
export const resolveGraphqlEndpoint = (baseUrl: string): string => {
  const restBase = resolveApiBaseUrl(baseUrl)
  if (restBase.endsWith(GHES_REST_SUFFIX)) {
    return `${restBase.slice(0, restBase.length - GHES_REST_SUFFIX.length)}/api/graphql`
  }
  if (restBase === GITHUB_DEFAULT_BASE_URL) {
    return `${restBase}/graphql`
  }
  return `${restBase}/api/graphql`
}
