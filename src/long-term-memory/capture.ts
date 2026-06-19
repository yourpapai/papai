// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import type { ModelMessage } from 'ai'

import { hasThreadContextId } from '../chat/scoped-context.js'
import type { ActorRole, ContextType } from '../chat/types.js'
import { getEmbeddingForContext } from '../embeddings.js'
import { resolveEffectiveLlmConfig } from '../llm-config-resolver.js'
import { buildChatModel } from '../llm-model-builder.js'
import { logger } from '../logger.js'
import { saveMemoryRecordWithEmbedding } from './embedding-writer.js'
import { markExtracted } from './extraction-state.js'
import { extractMemoryPatch, type MemoryPatch } from './extractor.js'
import { resolveMemoryScope } from './scope.js'
import { getMemoryProfile } from './store.js'
import type { MemoryRecordInput } from './types.js'

const log = logger.child({ scope: 'memory:capture' })

const EMPTY_PATCH: MemoryPatch = { profile: null, records: [], updates: [] }

export type RunMemoryCaptureInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  history: readonly ModelMessage[]
  actorRole?: ActorRole
}>

export type CaptureExtractInput = Readonly<{
  history: readonly ModelMessage[]
  profile: string
  configContextId: string
}>

export type RunMemoryCaptureDeps = Readonly<{
  extractMemoryPatch: (input: CaptureExtractInput) => Promise<MemoryPatch>
  getEmbedding: (text: string, configContextId: string) => Promise<number[] | null>
  now: () => string
  randomUUID: () => string
}>

const defaultExtract = (input: CaptureExtractInput): Promise<MemoryPatch> => {
  const resolved = resolveEffectiveLlmConfig(input.configContextId)
  if (!resolved.ok) {
    log.warn(
      { configContextId: input.configContextId, source: resolved.source, type: resolved.type },
      'LLM config unavailable for capture',
    )
    return Promise.resolve(EMPTY_PATCH)
  }
  const model = buildChatModel(resolved.llmApiKey, resolved.llmBaseUrl, resolved.smallModel)
  return extractMemoryPatch({ history: input.history, profile: input.profile, records: [], model })
}

const defaultDeps: RunMemoryCaptureDeps = {
  extractMemoryPatch: defaultExtract,
  getEmbedding: (text, configContextId) =>
    getEmbeddingForContext(text, configContextId, {
      storageContextId: configContextId,
      contextType: 'group',
      chatUserId: configContextId,
    }),
  now: () => new Date().toISOString(),
  randomUUID: () => randomUUID(),
}

type BuildRecordInput = Readonly<{
  candidate: MemoryPatch['records'][number]
  scope: ReturnType<typeof resolveMemoryScope>
  storageContextId: string
  now: string
  id: string
}>

const buildRecord = ({ candidate, scope, storageContextId, now, id }: BuildRecordInput): MemoryRecordInput => ({
  id,
  scopeId: scope.scopeId,
  scopeType: scope.scopeType,
  kind: candidate.kind,
  content: candidate.content,
  summary: candidate.summary ?? null,
  tags: candidate.tags,
  confidence: candidate.confidence,
  status: 'provisional',
  source: 'background',
  evidence: { ...candidate.evidence, threads: [storageContextId], contextId: storageContextId },
  threadContextId: storageContextId,
  createdAt: now,
  updatedAt: now,
  lastSeenAt: now,
})

export async function runMemoryCapture(
  input: RunMemoryCaptureInput,
  deps: RunMemoryCaptureDeps = defaultDeps,
): Promise<void> {
  if (input.contextType !== 'group' || !hasThreadContextId(input.storageContextId)) return

  const scope = resolveMemoryScope({ storageContextId: input.storageContextId, contextType: input.contextType })
  const profile = getMemoryProfile(scope)
  if (profile?.enabled === false) return

  let patch: MemoryPatch
  try {
    patch = await deps.extractMemoryPatch({
      history: input.history,
      profile: profile?.profile ?? '',
      configContextId: input.configContextId,
    })
  } catch (error) {
    log.warn(
      { contextId: input.storageContextId, error: error instanceof Error ? error.message : String(error) },
      'Capture extraction failed',
    )
    return
  }

  const now = deps.now()
  const records = patch.records.map((candidate) =>
    buildRecord({ candidate, scope, storageContextId: input.storageContextId, now, id: deps.randomUUID() }),
  )
  await Promise.all(
    records.map((record) =>
      saveMemoryRecordWithEmbedding(record, input.configContextId, { getEmbedding: deps.getEmbedding }),
    ),
  )

  markExtracted(input.storageContextId, input.history.length, now)
  log.debug({ contextId: input.storageContextId, captured: patch.records.length }, 'Memory capture complete')
}
