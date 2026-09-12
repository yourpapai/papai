// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  LlmModelMetadataResponseSchema,
  type LlmModelMetadata,
  type LlmModelMetadataQuery,
} from './fetcher-schemas-llm-providers.js'
import { getJson } from './fetchers.js'

export const fetchLlmModelMetadata = (
  input: LlmModelMetadataQuery,
  options?: { signal?: AbortSignal },
): Promise<LlmModelMetadata> => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') params.set(key, value)
  }
  const query = params.toString()
  const path = query.length > 0 ? `/settings/api/llm-model-metadata?${query}` : '/settings/api/llm-model-metadata'
  return getJson(path, (body) => LlmModelMetadataResponseSchema.parse(body), { signal: options?.signal })
}
