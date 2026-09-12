// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, http } from 'msw'
import type { HttpHandler } from 'msw'

// One fixed snapshot instant so all four states render identically apart from
// the payload they are meant to showcase.
const SNAPSHOT_MS = 1_760_000_000_000

export interface LlmModelMetadataHandlerFamily {
  modelsDev: HttpHandler[]
  prefixTable: HttpHandler[]
  noLimits: HttpHandler[]
  catalogueUnavailable: HttpHandler[]
}

// The four ModelMetadataHint states (see the component's story file): a direct
// models.dev catalogue hit, a prefix-table guess, a resolved-but-unknown model,
// and a stale/absent snapshot.
export const llmModelMetadataHandlers: LlmModelMetadataHandlerFamily = {
  modelsDev: [
    http.get('/settings/api/llm-model-metadata', () =>
      HttpResponse.json({
        providerId: 'openai',
        modelId: 'gpt-4o',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        source: 'models-dev',
        via: 'inferred',
        snapshotFetchedAt: SNAPSHOT_MS,
      }),
    ),
  ],
  prefixTable: [
    http.get('/settings/api/llm-model-metadata', () =>
      HttpResponse.json({
        providerId: 'openai',
        modelId: 'gpt-4o-2024-08-06',
        contextWindow: 128000,
        maxOutputTokens: null,
        source: 'prefix-table',
        via: null,
        snapshotFetchedAt: SNAPSHOT_MS,
      }),
    ),
  ],
  noLimits: [
    http.get('/settings/api/llm-model-metadata', () =>
      HttpResponse.json({
        providerId: null,
        modelId: null,
        contextWindow: null,
        maxOutputTokens: null,
        source: 'none',
        via: null,
        snapshotFetchedAt: SNAPSHOT_MS,
      }),
    ),
  ],
  catalogueUnavailable: [
    http.get('/settings/api/llm-model-metadata', () =>
      HttpResponse.json({
        providerId: null,
        modelId: null,
        contextWindow: null,
        maxOutputTokens: null,
        source: 'none',
        via: null,
        snapshotFetchedAt: null,
      }),
    ),
  ],
}
