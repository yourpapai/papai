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

export type ModelsDevReasoningOption = {
  readonly kind: string
  readonly values: readonly string[]
}

export type ModelsDevModelEntry = {
  readonly limit?: ModelsDevLimit
  readonly reasoning?: boolean
  readonly reasoningOptions?: readonly ModelsDevReasoningOption[]
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
  readonly reasoning?: boolean | null
  readonly effortLevels?: readonly string[] | null
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

const reasoningOf = (
  entry: ModelsDevModelEntry | undefined,
): { reasoning?: boolean; effortLevels?: readonly string[] } => {
  const levels = entry?.reasoningOptions?.[0]?.values
  const shaped: { reasoning?: boolean; effortLevels?: readonly string[] } = {}
  if (entry?.reasoning !== undefined) shaped.reasoning = entry.reasoning
  if (levels !== undefined) shaped.effortLevels = levels
  return shaped
}

const sameLevels = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean => {
  if (a === undefined || b === undefined) return a === b
  return a.length === b.length && a.every((level, index) => level === b[index])
}

const prefixTableResult = (model: string): ModelMetadata => {
  const contextWindow = prefixTableContextWindow(model)
  if (contextWindow !== null) {
    return { providerId: null, modelId: null, contextWindow, maxOutputTokens: null, source: 'prefix-table', via: null }
  }
  return { providerId: null, modelId: null, contextWindow: null, maxOutputTokens: null, source: 'none', via: null }
}

const isDeclared = (value: string | null | undefined): value is string =>
  value !== undefined && value !== null && value !== ''

const overrideResult = (input: ModelMetadataInput, providers: ModelsDevSnapshot['providers']): ModelMetadata | null => {
  if (!isDeclared(input.baseProvider) || !isDeclared(input.baseModel)) return null
  const entry = providers[input.baseProvider]?.models[input.baseModel]
  if (entry === undefined) return prefixTableResult(input.model)
  return {
    providerId: input.baseProvider,
    modelId: input.baseModel,
    ...limitsOf(entry),
    ...reasoningOf(entry),
    source: 'models-dev',
    via: 'override',
  }
}

const inferredResult = (input: ModelMetadataInput, providers: ModelsDevSnapshot['providers']): ModelMetadata | null => {
  const providerId = inferProviderId({ providerType: input.providerType, baseUrl: input.baseUrl })
  if (providerId === null) return null
  const entry = providers[providerId]?.models[input.model]
  if (entry === undefined) return prefixTableResult(input.model)
  return {
    providerId,
    modelId: input.model,
    ...limitsOf(entry),
    ...reasoningOf(entry),
    source: 'models-dev',
    via: 'inferred',
  }
}

const ambiguousNameResult = (model: string, providers: ModelsDevSnapshot['providers']): ModelMetadata => {
  const matches = Object.keys(providers)
    .sort()
    .flatMap((candidateId) => {
      const entry = providers[candidateId]?.models[model]
      return entry === undefined ? [] : [{ providerId: candidateId, ...limitsOf(entry), ...reasoningOf(entry) }]
    })
  // Ambiguous-name tie-break shared with resolveMaxTokens (src/model-context.ts, design D4): trust
  // the catalogue only when every provider carrying this id agrees on the context window. An output
  // cap is kept only when it is unambiguous too — an unknown cap sends no cap (spec.md, generation
  // without an output-cap setting), so both surfaces report the same window for the same name.
  const first = matches[0]
  if (first !== undefined && matches.every((match) => match.contextWindow === first.contextWindow)) {
    const cap = matches.every((match) => match.maxOutputTokens === first.maxOutputTokens) ? first.maxOutputTokens : null
    const levels = matches.every((match) => sameLevels(match.effortLevels, first.effortLevels))
      ? first.effortLevels
      : null
    // The reasoning flag is catalogue data feeding the same derived level set (src/models-dev/effort-levels.ts
    // consults `reasoning === false` exactly when levels are absent), so it follows the same agreement rule:
    // on disagreement report no flag, making the derived set the fallback union for every provider order.
    const reasoning = matches.every((match) => match.reasoning === first.reasoning) ? first.reasoning : undefined
    return {
      ...first,
      reasoning,
      maxOutputTokens: cap,
      effortLevels: levels,
      modelId: model,
      source: 'models-dev',
      via: 'inferred',
    }
  }
  return prefixTableResult(model)
}

export function resolveModelMetadata(input: ModelMetadataInput, deps?: ResolveModelMetadataDeps): ModelMetadata {
  const { providers } = (deps?.getSnapshot ?? getModelsDevSnapshot)()
  return (
    overrideResult(input, providers) ?? inferredResult(input, providers) ?? ambiguousNameResult(input.model, providers)
  )
}
