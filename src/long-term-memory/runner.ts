// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import type { LanguageModel, ModelMessage } from 'ai'

import type { ContextType } from '../chat/types.js'
import { buildChatModel } from '../llm-model-builder.js'
import { resolveLlmConfig } from '../llm-providers/resolver.js'
import type { EffectiveLlmConfig, LlmConfigResult } from '../llm-providers/types.js'
import { logger } from '../logger.js'
import { extractMemoryPatch, type MemoryPatch } from './extractor.js'
import { visibleProfileText } from './profile-visibility.js'
import { resolveMemoryScope } from './scope.js'
import {
  getMemoryProfile,
  listMemoryRecords,
  saveMemoryProfile,
  saveMemoryRecord,
  updateMemoryRecord,
} from './store.js'
import { isContentTombstoned } from './tombstone.js'
import type { MemoryRecord, MemoryScope } from './types.js'

const log = logger.child({ scope: 'long-term-memory:runner' })

type ResolvedConfig = EffectiveLlmConfig

export type RunMemoryExtractionInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  history: readonly ModelMessage[]
  deps?: Partial<RunMemoryExtractionDeps>
}>

export type RunMemoryExtractionDeps = Readonly<{
  extractMemoryPatch: (input: ExtractMemoryPatchRunInput) => Promise<MemoryPatch>
  resolveConfig: (configContextId: string) => LlmConfigResult
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
  buildChatModel(config.small.apiKey, config.small.baseUrl, config.small.model)

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
  resolveConfig: (configContextId) => resolveLlmConfig(configContextId),
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
  resolved: Exclude<LlmConfigResult, { readonly ok: true }>,
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

type SuppressibleCount = Readonly<{ count: number; suppressed: number }>

const insertRecords = (scope: MemoryScope, patch: MemoryPatch, deps: RunMemoryExtractionDeps): SuppressibleCount => {
  const now = deps.now()
  return patch.records.reduce<SuppressibleCount>(
    (acc, record) => {
      if (isContentTombstoned(scope, record.content)) return { ...acc, suppressed: acc.suppressed + 1 }
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
      return { ...acc, count: acc.count + 1 }
    },
    { count: 0, suppressed: 0 },
  )
}

const applyUpdates = (scope: MemoryScope, patch: MemoryPatch, now: string): SuppressibleCount =>
  patch.updates.reduce<SuppressibleCount>(
    (acc, update) => {
      if (update.content !== undefined && isContentTombstoned(scope, update.content)) {
        return { ...acc, suppressed: acc.suppressed + 1 }
      }
      const updated = updateMemoryRecord(scope, update.id, update, now)
      return updated === null ? acc : { ...acc, count: acc.count + 1 }
    },
    { count: 0, suppressed: 0 },
  )

const shouldResolveModel = (input: RunMemoryExtractionInput): boolean =>
  input.deps?.extractMemoryPatch === undefined || input.deps.buildModel !== undefined

const resolveModel = (
  input: RunMemoryExtractionInput,
  scope: MemoryScope,
  deps: RunMemoryExtractionDeps,
): LanguageModel | null => {
  if (!shouldResolveModel(input)) return null
  const resolvedConfig = deps.resolveConfig(input.configContextId)
  if (!resolvedConfig.ok) {
    logConfigFailure(input, scope, resolvedConfig)
    return null
  }
  return deps.buildModel(resolvedConfig)
}

const logExtractionComplete = (
  input: RunMemoryExtractionInput,
  scope: MemoryScope,
  patch: MemoryPatch,
  insertResult: SuppressibleCount,
  updateResult: SuppressibleCount,
): void => {
  log.info(
    {
      storageContextId: input.storageContextId,
      configContextId: input.configContextId,
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      inserted: insertResult.count,
      updated: updateResult.count,
      suppressed: insertResult.suppressed + updateResult.suppressed,
      profileUpdated: patch.profile !== null,
    },
    'Long-term memory extraction complete',
  )
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
    // Never feed contaminated prose back into extraction: the LLM would copy the
    // erased fact into the replacement profile and make it durable again.
    profile: visibleProfileText(profile),
    records,
    model,
  })

  const now = deps.now()
  if (patch.profile !== null) {
    saveMemoryProfile(scope, patch.profile, now)
  }
  const insertResult = insertRecords(scope, patch, deps)
  const updateResult = applyUpdates(scope, patch, now)
  logExtractionComplete(input, scope, patch, insertResult, updateResult)
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
