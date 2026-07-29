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
  type NormalizedPublicCase,
  type PublicImportIssue,
} from './importer-types.js'

const questionTypeSchema = z
  .string()
  .regex(
    /^(single-session-user|single-session-assistant|single-session-preference|temporal-reasoning|knowledge-update|multi-session)$/u,
  )

const turnSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    has_answer: z.boolean().optional(),
  })
  .strict()
  .readonly()

const recordSchema = z
  .object({
    question_id: z.string().min(1),
    question_type: questionTypeSchema,
    question: z.string().min(1),
    answer: z.json(),
    question_date: z.string().min(1),
    haystack_session_ids: z.array(z.string().min(1)).min(1).readonly(),
    haystack_dates: z.array(z.string().min(1)).min(1).readonly(),
    haystack_sessions: z.array(z.array(turnSchema).min(1).readonly()).min(1).readonly(),
    answer_session_ids: z.array(z.string().min(1)).readonly(),
  })
  .strict()
  .readonly()

const datasetSchema = z.array(recordSchema).min(1).readonly()
type LongMemEvalRecord = z.infer<typeof recordSchema>

const duplicateValues = (values: readonly string[]): readonly string[] => {
  const unique = new Set(values)
  return [...unique].filter((value) => values.filter((candidate) => candidate === value).length > 1)
}

const recordIssues = (record: LongMemEvalRecord, recordIndex: number): readonly PublicImportIssue[] => {
  const prefix = `$[${recordIndex}]`
  const sessionIds = new Set(record.haystack_session_ids)
  return [
    ...(record.haystack_dates.length === record.haystack_session_ids.length
      ? []
      : [semanticIssue(`${prefix}.haystack_dates`, 'must have the same length as haystack_session_ids', recordIndex)]),
    ...(record.haystack_sessions.length === record.haystack_session_ids.length
      ? []
      : [
          semanticIssue(
            `${prefix}.haystack_sessions`,
            'must have the same length as haystack_session_ids',
            recordIndex,
          ),
        ]),
    ...duplicateValues(record.haystack_session_ids).map((sessionId) =>
      semanticIssue(`${prefix}.haystack_session_ids`, `duplicate official session id: ${sessionId}`, recordIndex),
    ),
    ...record.answer_session_ids.flatMap((sessionId, answerIndex) =>
      sessionIds.has(sessionId)
        ? []
        : [
            semanticIssue(
              `${prefix}.answer_session_ids[${answerIndex}]`,
              `official answer-session reference does not exist: ${sessionId}`,
              recordIndex,
            ),
          ],
    ),
  ]
}

const questionIdIssues = (records: readonly LongMemEvalRecord[]): readonly PublicImportIssue[] =>
  duplicateValues(records.map(({ question_id: questionId }) => questionId)).map((questionId) =>
    semanticIssue('$', `duplicate official question id: ${questionId}`, null),
  )

const normalizeRecord = (record: LongMemEvalRecord, recordIndex: number): NormalizedPublicCase => {
  const sessions = record.haystack_session_ids.map((sessionId, sessionIndex) => ({
    sessionId,
    timestamp: record.haystack_dates[sessionIndex] ?? null,
    messages: (record.haystack_sessions[sessionIndex] ?? []).map((turn, turnIndex) => ({
      messageId: `${sessionId}:turn:${turnIndex}`,
      role: turn.role,
      speaker: null,
      content: turn.content,
      officialEvidence: turn.has_answer === true,
    })),
  }))
  const abstention = record.question_id.endsWith('_abs')
  return {
    caseId: record.question_id,
    sourceRecordIndex: recordIndex,
    category: record.question_type,
    sessions,
    questions: [
      {
        questionId: record.question_id,
        text: record.question,
        timestamp: record.question_date,
        category: record.question_type,
        abstention,
        officialAnswers: [record.answer],
        officialChoices: null,
        officialEvidenceRefs: record.answer_session_ids,
        evidenceGranularity: 'session',
      },
    ],
  }
}

export const parseLongMemEval = (value: unknown): CaseValidationResult => {
  const parsed = datasetSchema.safeParse(value)
  if (!parsed.success) return rejectedCases('invalid_shape', issuesFromZod(parsed.error))

  const issues = [...parsed.data.flatMap(recordIssues), ...questionIdIssues(parsed.data)]
  return issues.length > 0
    ? rejectedCases('invalid_reference', issues)
    : acceptedCases(parsed.data.map(normalizeRecord))
}
