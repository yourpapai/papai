// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { CodingModelsResponseSchema, type CodingModelsResponse } from './fetcher-schemas-coding-models.js'
import { CodingCredentialsResponseSchema, type CodingCredentialsResponse } from './fetcher-schemas.js'
import { ctxQuery, getJson, writeJson } from './fetchers.js'

export const fetchCodingCredentials = (
  contextId: string,
  namespace = 'agent-provider',
): Promise<CodingCredentialsResponse> =>
  getJson(`/settings/api/coding-credentials?${ctxQuery(contextId)}&namespace=${encodeURIComponent(namespace)}`, (b) =>
    CodingCredentialsResponseSchema.parse(b),
  )

export const patchCodingCredentials = (input: {
  contextId: string
  namespace?: string
  values: Record<string, string>
}): Promise<unknown> => writeJson('/settings/api/coding-credentials', 'PATCH', input, (b) => b)

export const clearCodingCredentials = (input: { contextId: string; namespace?: string }): Promise<unknown> =>
  writeJson('/settings/api/coding-credentials', 'PATCH', { ...input, clear: true }, (b) => b)

export const fetchCodingModels = (contextId: string, agent: string): Promise<CodingModelsResponse> =>
  getJson(`/settings/api/coding-credentials/models?${ctxQuery(contextId)}&agent=${encodeURIComponent(agent)}`, (b) =>
    CodingModelsResponseSchema.parse(b),
  )
