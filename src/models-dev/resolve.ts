// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { prefixTableContextWindow } from '../model-context.js'
import { getModelsDevSnapshot } from './client.js'
import { inferProviderId } from './provider-id.js'

export type ModelsDevLimit = {
  readonly context?: number
  readonly output?: number
}

export type ModelsDevModelEntry = {
  readonly limit?: ModelsDevLimit
}

export type ModelsDevProvider = {
  readonly models: Readonly<Record<string, ModelsDevModelEntry>>
}

export type ModelsDevSnapshot = {
  readonly fetchedAt: number | null
  readonly providers: Readonly<Record<string, ModelsDevProvider>>
}

export type ModelMetadataInput = {
  readonly providerType?: string | null
  readonly baseUrl?: string | null
  readonly baseProvider?: string | null
  readonly baseModel?: string | null
  readonly model: string
}

export type ModelMetadata = {
  readonly providerId: string | null
  readonly modelId: string | null
  readonly contextWindow: number | null
  readonly maxOutputTokens: number | null
  readonly source: 'models-dev' | 'prefix-table' | 'none'
  readonly via: 'override' | 'inferred' | null
}

export type SnapshotGetter = () => ModelsDevSnapshot

export type ResolveModelMetadataDeps = {
  readonly getSnapshot: SnapshotGetter
}

const limitsOf = (
  entry: ModelsDevModelEntry | undefined,
): { contextWindow: number | null; maxOutputTokens: number | null } => ({
  contextWindow: entry?.limit?.context ?? null,
  maxOutputTokens: entry?.limit?.output ?? null,
})

const prefixTableResult = (model: string): ModelMetadata => {
  const contextWindow = prefixTableContextWindow(model)
  if (contextWindow !== null) {
    return { providerId: null, modelId: null, contextWindow, maxOutputTokens: null, source: 'prefix-table', via: null }
  }
  return { providerId: null, modelId: null, contextWindow: null, maxOutputTokens: null, source: 'none', via: null }
}

const isDeclared = (value: string | null | undefined): value is string =>
  value !== undefined && value !== null && value !== ''

export function resolveModelMetadata(input: ModelMetadataInput, deps?: ResolveModelMetadataDeps): ModelMetadata {
  const { providers } = (deps?.getSnapshot ?? getModelsDevSnapshot)()
  const model = input.model

  if (isDeclared(input.baseProvider) && isDeclared(input.baseModel)) {
    const entry = providers[input.baseProvider]?.models[input.baseModel]
    if (entry !== undefined) {
      return {
        providerId: input.baseProvider,
        modelId: input.baseModel,
        ...limitsOf(entry),
        source: 'models-dev',
        via: 'override',
      }
    }
    return prefixTableResult(model)
  }

  const providerId = inferProviderId({ providerType: input.providerType, baseUrl: input.baseUrl })
  if (providerId !== null) {
    const entry = providers[providerId]?.models[model]
    if (entry !== undefined) {
      return { providerId, modelId: model, ...limitsOf(entry), source: 'models-dev', via: 'inferred' }
    }
    return prefixTableResult(model)
  }

  const matches = Object.keys(providers)
    .sort()
    .flatMap((candidateId) => {
      const entry = providers[candidateId]?.models[model]
      return entry === undefined ? [] : [{ providerId: candidateId, ...limitsOf(entry) }]
    })
  // Ambiguous-name tie-break shared with resolveMaxTokens (src/model-context.ts, design D4): trust
  // the catalogue only when every provider carrying this id agrees on the context window. An output
  // cap is kept only when it is unambiguous too — an unknown cap sends no cap (spec.md, generation
  // without an output-cap setting), so both surfaces report the same window for the same name.
  const first = matches[0]
  if (first !== undefined && matches.every((match) => match.contextWindow === first.contextWindow)) {
    const cap = matches.every((match) => match.maxOutputTokens === first.maxOutputTokens) ? first.maxOutputTokens : null
    return { ...first, maxOutputTokens: cap, modelId: model, source: 'models-dev', via: 'inferred' }
  }

  return prefixTableResult(model)
}
