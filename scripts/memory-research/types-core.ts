// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const DETERMINISTIC_EMBEDDING_VERSION = 'papai-deterministic-bilingual-v1'
export const DETERMINISTIC_EMBEDDING_DIMENSION = 64
export const MAX_MEMORY_HIT_CONTENT_CHARACTERS = 16_384
export const MAX_MEMORY_HIT_PROVENANCE_EVIDENCE_IDS = 64

export const StableIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)

export const TimestampSchema = z.iso.datetime({ offset: true })
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)

export const CandidateIdSchema = z.enum(['as-shipped', 'corrected-hybrid', 'hierarchical', 'temporal-graph'])
export const ScopeKindSchema = z.enum(['personal', 'group'])
export const LanguageSchema = z.enum(['en', 'ru'])
export const ScenarioSplitSchema = z.enum(['development', 'sealed-test'])
export const ScaleProfileSchema = z.union([z.literal(1_000), z.literal(10_000), z.literal(100_000)])

export const EventIdSchema = StableIdSchema.brand<'EventId'>()
export const EvidenceIdSchema = StableIdSchema.brand<'EvidenceId'>()
export const QueryIdSchema = StableIdSchema.brand<'QueryId'>()
export const ScenarioIdSchema = StableIdSchema.brand<'ScenarioId'>()

export const MemoryScopeSchema = z
  .object({
    kind: ScopeKindSchema,
    id: StableIdSchema,
  })
  .strict()
  .readonly()

export const ValidityIntervalSchema = z
  .object({
    validFrom: TimestampSchema,
    validTo: TimestampSchema.nullable(),
  })
  .strict()
  .refine(({ validFrom, validTo }) => validTo === null || Date.parse(validTo) >= Date.parse(validFrom), {
    message: 'validTo must be at or after validFrom',
  })
  .readonly()

export const MemoryEntitySchema = z
  .object({
    entityId: StableIdSchema,
    type: StableIdSchema,
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)).readonly(),
  })
  .strict()
  .readonly()

export const MemoryRelationSchema = z
  .object({
    relationId: StableIdSchema,
    sourceEntityId: StableIdSchema,
    targetEntityId: StableIdSchema,
    type: StableIdSchema,
    validity: ValidityIntervalSchema,
  })
  .strict()
  .readonly()

export const EmbeddingControlSchema = z
  .object({
    available: z.boolean(),
    version: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine(({ available, version }, context) => {
    if (available && version === null) {
      context.addIssue({
        code: 'custom',
        message: 'available embeddings require a version',
        path: ['version'],
      })
    }
  })
  .readonly()

export const MemoryEventSchema = z
  .object({
    eventId: EventIdSchema,
    evidenceId: EvidenceIdSchema,
    scope: MemoryScopeSchema,
    language: LanguageSchema,
    eventTime: TimestampSchema,
    ingestTime: TimestampSchema,
    content: z.string().min(1),
    type: z.enum(['message', 'fact', 'preference', 'task', 'relationship', 'system']),
    threadId: StableIdSchema.nullable(),
    entities: z.array(MemoryEntitySchema).readonly(),
    relations: z.array(MemoryRelationSchema).readonly(),
    validity: ValidityIntervalSchema,
    embedding: EmbeddingControlSchema,
  })
  .strict()
  .readonly()

export const SliceLabelSchema = z.enum([
  'direct-fact',
  'long-range',
  'knowledge-update',
  'temporal-conflict',
  'lexical-exact',
  'semantic-paraphrase',
  'missing-embedding',
  'graph-multi-hop',
  'duplicate-out-of-order',
  'restart-rebuild',
  'erasure-non-recapture',
  'abstention',
  'guest-visibility',
  'cross-scope',
])

const operationalMemoryQueryShape = {
  queryId: QueryIdSchema,
  authorizedScope: MemoryScopeSchema,
  actorRole: z.enum(['owner', 'member', 'guest']),
  language: LanguageSchema,
  queryTime: TimestampSchema,
  k: z.number().int().positive().max(1_000),
  contextTokenBudget: z.number().int().positive(),
  text: z.string().min(1),
} as const

export const OperationalMemoryQuerySchema = z.object(operationalMemoryQueryShape).strict().readonly()

export const MemoryQuerySchema = z
  .object({
    ...operationalMemoryQueryShape,
    expectedEvidenceIds: z.array(EvidenceIdSchema).readonly(),
    forbiddenEvidenceIds: z.array(EvidenceIdSchema).readonly(),
    erasedEvidenceIds: z.array(EvidenceIdSchema).readonly(),
    slices: z.array(SliceLabelSchema).min(1).readonly(),
  })
  .strict()
  .readonly()

export const ScoreComponentsSchema = z
  .object({
    lexical: z.number(),
    dense: z.number(),
    graph: z.number(),
    recency: z.number(),
    total: z.number(),
  })
  .strict()
  .readonly()

export const HitProvenanceSchema = z
  .object({
    kind: z.enum(['canonical', 'derived']),
    derivedFromEvidenceIds: z.array(EvidenceIdSchema).max(MAX_MEMORY_HIT_PROVENANCE_EVIDENCE_IDS).readonly(),
  })
  .strict()
  .refine(({ kind, derivedFromEvidenceIds }) => kind === 'canonical' || derivedFromEvidenceIds.length > 0, {
    message: 'derived hits require canonical evidence provenance',
  })
  .readonly()

export const MemoryHitSchema = z
  .object({
    evidenceId: EvidenceIdSchema,
    sourceEventId: EventIdSchema,
    scope: MemoryScopeSchema,
    score: ScoreComponentsSchema,
    rank: z.number().int().positive(),
    content: z.string().min(1).max(MAX_MEMORY_HIT_CONTENT_CHARACTERS),
    validity: ValidityIntervalSchema,
    provenance: HitProvenanceSchema,
  })
  .strict()
  .readonly()

const evidenceForgetSchema = z
  .object({
    kind: z.literal('evidence'),
    scope: MemoryScopeSchema,
    evidenceIds: z.array(EvidenceIdSchema).min(1).readonly(),
    completedAt: TimestampSchema,
  })
  .strict()

const subjectForgetSchema = z
  .object({
    kind: z.literal('subject'),
    scope: MemoryScopeSchema,
    subjectId: StableIdSchema,
    completedAt: TimestampSchema,
  })
  .strict()

const scopeForgetSchema = z
  .object({
    kind: z.literal('scope'),
    scope: MemoryScopeSchema,
    completedAt: TimestampSchema,
  })
  .strict()

export const ForgetRequestSchema = z
  .discriminatedUnion('kind', [evidenceForgetSchema, subjectForgetSchema, scopeForgetSchema])
  .readonly()

export const EmbeddingVersionChangeSchema = z
  .object({
    evidenceId: EvidenceIdSchema,
    fromVersion: z.string().min(1).nullable(),
    toVersion: z.string().min(1).nullable(),
    changedAt: TimestampSchema,
  })
  .strict()
  .refine(({ fromVersion, toVersion }) => fromVersion !== toVersion, {
    message: 'embedding version change must change the version',
  })
  .readonly()

export const ScenarioFaultsSchema = z
  .object({
    missingEmbeddingEvidenceIds: z.array(EvidenceIdSchema).readonly(),
    embeddingVersionChanges: z.array(EmbeddingVersionChangeSchema).readonly(),
    duplicateEvidenceIds: z.array(EvidenceIdSchema).readonly(),
    ingestOrder: z.array(EventIdSchema).readonly(),
    restartBeforeQueryIds: z.array(QueryIdSchema).readonly(),
    recaptureAfterForgetEvidenceIds: z.array(EvidenceIdSchema).readonly(),
    crossScopeProbeQueryIds: z.array(QueryIdSchema).readonly(),
    rebuildBeforeQueryIds: z.array(QueryIdSchema).readonly(),
  })
  .strict()
  .readonly()

export type CandidateId = z.infer<typeof CandidateIdSchema>
export type MemoryScope = z.infer<typeof MemoryScopeSchema>
export type MemoryEntity = z.infer<typeof MemoryEntitySchema>
export type MemoryRelation = z.infer<typeof MemoryRelationSchema>
export type MemoryEvent = z.infer<typeof MemoryEventSchema>
export type SliceLabel = z.infer<typeof SliceLabelSchema>
export type OperationalMemoryQuery = z.infer<typeof OperationalMemoryQuerySchema>
export type MemoryQuery = z.infer<typeof MemoryQuerySchema>
export type MemoryHit = z.infer<typeof MemoryHitSchema>
export type ForgetRequest = z.infer<typeof ForgetRequestSchema>

export const toOperationalMemoryQuery = (query: MemoryQuery): OperationalMemoryQuery =>
  OperationalMemoryQuerySchema.parse({
    queryId: query.queryId,
    authorizedScope: query.authorizedScope,
    actorRole: query.actorRole,
    language: query.language,
    queryTime: query.queryTime,
    k: query.k,
    contextTokenBudget: query.contextTokenBudget,
    text: query.text,
  })
