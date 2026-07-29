// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  acceptedCases,
  issuesFromZod,
  rejectedCases,
  semanticIssue,
  type CaseValidationResult,
  type MemoryAgentBenchCompetency,
  type NormalizedPublicCase,
  type PublicImportIssue,
} from './importer-types.js'

const nullableStringArray = z.array(z.string().min(1)).readonly().nullable()

const haystackTurnSchema = z
  .object({
    content: z.string(),
    has_answer: z.boolean(),
    role: z.string().min(1),
  })
  .strict()
  .readonly()

const haystackSessionsSchema = z
  .array(z.array(z.array(haystackTurnSchema).readonly()).readonly())
  .readonly()
  .nullable()

const metadataSchema = z
  .object({
    qa_pair_ids: z.array(z.string().min(1)).min(1).readonly(),
    question_types: nullableStringArray,
    question_dates: nullableStringArray,
    question_ids: nullableStringArray,
    source: z.string().min(1).nullable(),
    demo: z.string().nullable(),
    haystack_sessions: haystackSessionsSchema,
    keypoints: nullableStringArray,
    previous_events: nullableStringArray,
  })
  .strict()
  .readonly()

const recordSchema = z
  .object({
    context: z.string(),
    questions: z.array(z.string().min(1)).min(1).readonly(),
    answers: z.array(z.array(z.string()).min(1).readonly()).min(1).readonly(),
    metadata: metadataSchema,
  })
  .strict()
  .readonly()

const datasetSchema = z.array(recordSchema).min(1).readonly()
type MemoryAgentBenchRecord = z.infer<typeof recordSchema>

const alignedArrayIssues = (record: MemoryAgentBenchRecord, recordIndex: number): readonly PublicImportIssue[] => {
  const expected = record.questions.length
  const arrays: readonly Readonly<{ path: string; length: number }>[] = [
    { path: 'answers', length: record.answers.length },
    { path: 'metadata.qa_pair_ids', length: record.metadata.qa_pair_ids.length },
    ...(record.metadata.question_types === null
      ? []
      : [{ path: 'metadata.question_types', length: record.metadata.question_types.length }]),
    ...(record.metadata.question_dates === null
      ? []
      : [{ path: 'metadata.question_dates', length: record.metadata.question_dates.length }]),
    ...(record.metadata.question_ids === null
      ? []
      : [{ path: 'metadata.question_ids', length: record.metadata.question_ids.length }]),
  ]
  return arrays.flatMap(({ path, length }) =>
    length === expected
      ? []
      : [
          semanticIssue(
            `$[${recordIndex}].${path}`,
            `must have ${expected} entries to align with questions; received ${length}`,
            recordIndex,
          ),
        ],
  )
}

const duplicateIdIssues = (records: readonly MemoryAgentBenchRecord[]): readonly PublicImportIssue[] => {
  const seen = new Set<string>()
  return records.flatMap((record, recordIndex) =>
    record.metadata.qa_pair_ids.flatMap((questionId, questionIndex) => {
      if (seen.has(questionId)) {
        return [
          semanticIssue(
            `$[${recordIndex}].metadata.qa_pair_ids[${questionIndex}]`,
            `duplicate official qa_pair_id: ${questionId}`,
            recordIndex,
          ),
        ]
      }
      seen.add(questionId)
      return []
    }),
  )
}

const normalizeRecord = (
  record: MemoryAgentBenchRecord,
  recordIndex: number,
  competencySplit: MemoryAgentBenchCompetency,
): NormalizedPublicCase => {
  const firstQuestionId = record.metadata.qa_pair_ids[0] ?? `record-${recordIndex}`
  return {
    caseId: `${competencySplit}:${firstQuestionId}`,
    sourceRecordIndex: recordIndex,
    category: competencySplit,
    sessions: [
      {
        sessionId: `${firstQuestionId}:context`,
        timestamp: null,
        messages: [
          {
            messageId: `${firstQuestionId}:context:0`,
            role: 'document',
            speaker: null,
            content: record.context,
            officialEvidence: false,
          },
        ],
      },
    ],
    questions: record.questions.map((text, questionIndex) => {
      return {
        questionId: record.metadata.qa_pair_ids[questionIndex] ?? `${firstQuestionId}:${questionIndex}`,
        text,
        timestamp: record.metadata.question_dates?.[questionIndex] ?? null,
        category: record.metadata.question_types?.[questionIndex] ?? competencySplit,
        abstention: false,
        officialAnswers: record.answers[questionIndex] ?? [],
        officialChoices: null,
        officialEvidenceRefs: [],
        evidenceGranularity: 'none',
      }
    }),
  }
}

export const parseMemoryAgentBench = (
  value: unknown,
  competencySplit: MemoryAgentBenchCompetency,
): CaseValidationResult => {
  const parsed = datasetSchema.safeParse(value)
  if (!parsed.success) return rejectedCases('invalid_revision', issuesFromZod(parsed.error))

  const issues = [...parsed.data.flatMap(alignedArrayIssues), ...duplicateIdIssues(parsed.data)]
  return issues.length > 0
    ? rejectedCases('invalid_shape', issues)
    : acceptedCases(parsed.data.map((record, index) => normalizeRecord(record, index, competencySplit)))
}
