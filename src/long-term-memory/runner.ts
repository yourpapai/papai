// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel, ModelMessage } from 'ai'

import type { ContextType } from '../chat/types.js'
import { resolveEffectiveLlmConfig, type EffectiveLlmConfig } from '../llm-config-resolver.js'
import { logger } from '../logger.js'
import { fetchWithoutTimeout } from '../utils/fetch.js'
import { extractMemoryPatch, type MemoryPatch } from './extractor.js'
import { resolveMemoryScope } from './scope.js'
import {
  getMemoryProfile,
  listMemoryRecords,
  saveMemoryProfile,
  saveMemoryRecord,
  updateMemoryRecord,
} from './store.js'
import type { MemoryRecord, MemoryScope } from './types.js'

const log = logger.child({ scope: 'long-term-memory:runner' })

type ResolvedConfig = Extract<ReturnType<typeof resolveEffectiveLlmConfig>, EffectiveLlmConfig>

export type RunMemoryExtractionInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  history: readonly ModelMessage[]
  deps?: Partial<RunMemoryExtractionDeps>
}>

export type RunMemoryExtractionDeps = Readonly<{
  extractMemoryPatch: (input: ExtractMemoryPatchRunInput) => Promise<MemoryPatch>
  resolveLlmConfig: (configContextId: string) => ReturnType<typeof resolveEffectiveLlmConfig>
  buildModel: (config: ResolvedConfig) => LanguageModel
  now: () => string
  randomUUID: () => string
}>

export type ExtractMemoryPatchRunInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  scope: MemoryScope
  history: readonly ModelMessage[]
  profile: string | null
  records: readonly MemoryRecord[]
  model: LanguageModel | null
}>

const buildModel = (config: ResolvedConfig): LanguageModel =>
  createOpenAICompatible({
    name: 'openai-compatible',
    apiKey: config.llmApiKey,
    baseURL: config.llmBaseUrl,
    fetch: fetchWithoutTimeout,
  })(config.smallModel)

const defaultDeps: RunMemoryExtractionDeps = {
  extractMemoryPatch: (input) => {
    if (input.model === null) {
      throw new Error('memory extraction model is required')
    }
    return extractMemoryPatch({
      history: input.history,
      profile: input.profile,
      records: input.records,
      model: input.model,
    })
  },
  resolveLlmConfig: (configContextId) => resolveEffectiveLlmConfig(configContextId),
  buildModel,
  now: () => new Date().toISOString(),
  randomUUID: () => randomUUID(),
}

const resolveDeps = (deps: Partial<RunMemoryExtractionDeps> | undefined): RunMemoryExtractionDeps => ({
  ...defaultDeps,
  ...deps,
})

const inFlight = new Set<string>()

const scopeKey = (scope: MemoryScope): string => `${scope.scopeType}:${scope.scopeId}`

const canonicalIsoOrNull = (value: string | undefined): string | null => {
  if (value === undefined) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

const logConfigFailure = (
  input: RunMemoryExtractionInput,
  scope: MemoryScope,
  resolved: Exclude<ReturnType<typeof resolveEffectiveLlmConfig>, { readonly ok: true }>,
): void => {
  log.warn(
    {
      storageContextId: input.storageContextId,
      configContextId: input.configContextId,
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      source: resolved.source,
      type: resolved.type,
      missing: resolved.type === 'missing' ? resolved.missing : undefined,
      error: resolved.type === 'error' ? resolved.error : undefined,
    },
    'LLM config not available for long-term memory extraction',
  )
}

const insertRecords = (scope: MemoryScope, patch: MemoryPatch, deps: RunMemoryExtractionDeps): number => {
  const now = deps.now()
  return patch.records.reduce((count, record) => {
    saveMemoryRecord({
      id: deps.randomUUID(),
      ...scope,
      kind: record.kind,
      content: record.content,
      summary: record.summary,
      tags: record.tags,
      confidence: record.confidence,
      status: 'active',
      source: 'background',
      evidence: record.evidence,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      validFrom: canonicalIsoOrNull(record.validFrom),
      validUntil: canonicalIsoOrNull(record.validUntil),
      expiresAt: canonicalIsoOrNull(record.expiresAt),
    })
    return count + 1
  }, 0)
}

const applyUpdates = (scope: MemoryScope, patch: MemoryPatch, now: string): number =>
  patch.updates.reduce((count, update) => {
    const updated = updateMemoryRecord(scope, update.id, update, now)
    return updated === null ? count : count + 1
  }, 0)

const shouldResolveModel = (input: RunMemoryExtractionInput): boolean =>
  input.deps?.extractMemoryPatch === undefined || input.deps.buildModel !== undefined

const resolveModel = (
  input: RunMemoryExtractionInput,
  scope: MemoryScope,
  deps: RunMemoryExtractionDeps,
): LanguageModel | null => {
  if (!shouldResolveModel(input)) return null
  const resolvedConfig = deps.resolveLlmConfig(input.configContextId)
  if (!resolvedConfig.ok) {
    logConfigFailure(input, scope, resolvedConfig)
    return null
  }
  return deps.buildModel(resolvedConfig)
}

const performExtraction = async (
  input: RunMemoryExtractionInput,
  scope: MemoryScope,
  deps: RunMemoryExtractionDeps,
): Promise<void> => {
  const profile = getMemoryProfile(scope)
  if (profile?.enabled === false) {
    log.debug({ scopeId: scope.scopeId, scopeType: scope.scopeType }, 'Long-term memory capture disabled; skipping')
    return
  }

  const records = listMemoryRecords({ ...scope, status: 'active' })
  const model = resolveModel(input, scope, deps)
  if (model === null && shouldResolveModel(input)) {
    return
  }

  const patch = await deps.extractMemoryPatch({
    storageContextId: input.storageContextId,
    configContextId: input.configContextId,
    contextType: input.contextType,
    scope,
    history: input.history,
    profile: profile?.profile ?? null,
    records,
    model,
  })

  const now = deps.now()
  if (patch.profile !== null) {
    saveMemoryProfile(scope, patch.profile, now)
  }
  const inserted = insertRecords(scope, patch, deps)
  const updated = applyUpdates(scope, patch, now)

  log.info(
    {
      storageContextId: input.storageContextId,
      configContextId: input.configContextId,
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      inserted,
      updated,
      profileUpdated: patch.profile !== null,
    },
    'Long-term memory extraction complete',
  )
}

export async function runMemoryExtractionInBackground(input: RunMemoryExtractionInput): Promise<void> {
  const scope = resolveMemoryScope({ storageContextId: input.storageContextId, contextType: input.contextType })
  const key = scopeKey(scope)
  if (inFlight.has(key)) {
    log.debug({ scopeId: scope.scopeId, scopeType: scope.scopeType }, 'Long-term memory extraction already in flight')
    return
  }
  inFlight.add(key)
  try {
    await performExtraction(input, scope, resolveDeps(input.deps))
  } catch (error) {
    log.warn(
      {
        storageContextId: input.storageContextId,
        configContextId: input.configContextId,
        scopeId: scope.scopeId,
        scopeType: scope.scopeType,
        error: error instanceof Error ? error.message : String(error),
      },
      'Long-term memory extraction failed in background',
    )
  } finally {
    inFlight.delete(key)
  }
}
