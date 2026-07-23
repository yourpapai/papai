// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { normalizeLocomoRecord } from './importer-locomo-normalize.js'
import {
  acceptedCases,
  issuesFromZod,
  rejectedCases,
  semanticIssue,
  type CaseValidationResult,
  type PublicImportIssue,
} from './importer-types.js'

const turnSchema = z
  .object({
    speaker: z.string().min(1),
    dia_id: z.string().min(1),
    text: z.string(),
    img_url: z.array(z.string().min(1)).min(1).readonly().optional(),
    blip_caption: z.string().optional(),
    query: z.string().optional(),
    're-download': z.boolean().optional(),
  })
  .strict()
  .readonly()

const standardQaSchema = z
  .object({
    question: z.string().min(1),
    answer: z.json(),
    category: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    evidence: z.array(z.string().min(1)).readonly(),
  })
  .strict()
  .readonly()

const adversarialQaSchema = z
  .object({
    question: z.string().min(1),
    adversarial_answer: z.json(),
    category: z.literal(5),
    evidence: z.array(z.string().min(1)).readonly(),
  })
  .strict()
  .readonly()

const qaSchema = z.union([standardQaSchema, adversarialQaSchema])

const recordSchema = z
  .object({
    sample_id: z.string().min(1),
    conversation: z.record(z.string(), z.unknown()),
    observation: z.unknown().optional(),
    session_summary: z.unknown().optional(),
    event_summary: z.unknown().optional(),
    qa: z.array(qaSchema).min(1).readonly(),
  })
  .strict()
  .readonly()

const datasetSchema = z.array(recordSchema).readonly()
export type LocomoRecord = z.infer<typeof recordSchema>
type LocomoTurn = z.infer<typeof turnSchema>

export type LocomoSession = Readonly<{
  number: number
  sessionId: string
  timestamp: string
  turns: readonly LocomoTurn[]
}>

const sessionPattern = /^session_(\d+)$/u
const timestampPattern = /^session_(\d+)_date_time$/u

const nestedIssues = (error: z.ZodError, prefix: string, recordIndex: number): readonly PublicImportIssue[] =>
  issuesFromZod(error).map((issue) => ({
    ...issue,
    recordIndex,
    path: `${prefix}${issue.path.slice(1)}`,
  }))

const requiredSpeaker = (
  conversation: Readonly<Record<string, unknown>>,
  key: 'speaker_a' | 'speaker_b',
  recordIndex: number,
): Readonly<{ value: string | null; issues: readonly PublicImportIssue[] }> => {
  const value = conversation[key]
  return typeof value === 'string' && value.length > 0
    ? { value, issues: [] }
    : {
        value: null,
        issues: [semanticIssue(`$[${recordIndex}].conversation.${key}`, 'must be a non-empty string', recordIndex)],
      }
}

const unknownConversationIssues = (
  conversation: Readonly<Record<string, unknown>>,
  recordIndex: number,
): readonly PublicImportIssue[] =>
  Object.keys(conversation)
    .filter(
      (key) => key !== 'speaker_a' && key !== 'speaker_b' && !sessionPattern.test(key) && !timestampPattern.test(key),
    )
    .map((key) =>
      semanticIssue(
        `$[${recordIndex}].conversation.${key}`,
        `unsupported LoCoMo conversation field: ${key}`,
        recordIndex,
      ),
    )

const sessionNumbers = (conversation: Readonly<Record<string, unknown>>): readonly number[] =>
  Object.keys(conversation)
    .flatMap((key) => {
      const matched = sessionPattern.exec(key)
      return matched?.[1] === undefined ? [] : [Number(matched[1])]
    })
    .sort((left, right) => left - right)

const orphanTimestampIssues = (
  conversation: Readonly<Record<string, unknown>>,
  recordIndex: number,
): readonly PublicImportIssue[] =>
  Object.keys(conversation).flatMap((key) => {
    const matched = timestampPattern.exec(key)
    const number = matched?.[1]
    return number !== undefined && conversation[`session_${number}`] === undefined
      ? [
          semanticIssue(
            `$[${recordIndex}].conversation.${key}`,
            `timestamp has no matching session_${number}`,
            recordIndex,
          ),
        ]
      : []
  })

const parseSession = (
  conversation: Readonly<Record<string, unknown>>,
  number: number,
  recordIndex: number,
): Readonly<{ session: LocomoSession | null; issues: readonly PublicImportIssue[] }> => {
  const sessionKey = `session_${number}`
  const timestampKey = `${sessionKey}_date_time`
  const timestamp = conversation[timestampKey]
  const parsedTurns = z.array(turnSchema).min(1).readonly().safeParse(conversation[sessionKey])
  const issues = [
    ...(typeof timestamp === 'string' && timestamp.length > 0
      ? []
      : [
          semanticIssue(
            `$[${recordIndex}].conversation.${timestampKey}`,
            `missing non-empty timestamp for ${sessionKey}`,
            recordIndex,
          ),
        ]),
    ...(parsedTurns.success
      ? []
      : nestedIssues(parsedTurns.error, `$[${recordIndex}].conversation.${sessionKey}`, recordIndex)),
  ]
  return issues.length > 0 || !parsedTurns.success || typeof timestamp !== 'string'
    ? { session: null, issues }
    : {
        session: {
          number,
          sessionId: sessionKey,
          timestamp,
          turns: parsedTurns.data,
        },
        issues: [],
      }
}

type ConversationDetails = Readonly<{
  sessions: readonly LocomoSession[]
  issues: readonly PublicImportIssue[]
}>

const turnSpeakerIssues = (
  sessions: readonly LocomoSession[],
  speakers: readonly (string | null)[],
  recordIndex: number,
): readonly PublicImportIssue[] => {
  const declared = new Set(speakers.flatMap((speaker) => (speaker === null ? [] : [speaker])))
  return sessions.flatMap((session) =>
    session.turns.flatMap((turn, turnIndex) =>
      declared.has(turn.speaker)
        ? []
        : [
            semanticIssue(
              `$[${recordIndex}].conversation.session_${session.number}[${turnIndex}].speaker`,
              `turn speaker is not speaker_a or speaker_b: ${turn.speaker}`,
              recordIndex,
            ),
          ],
    ),
  )
}

const conversationDetails = (record: LocomoRecord, recordIndex: number): ConversationDetails => {
  const speakerA = requiredSpeaker(record.conversation, 'speaker_a', recordIndex)
  const speakerB = requiredSpeaker(record.conversation, 'speaker_b', recordIndex)
  const parsedSessions = sessionNumbers(record.conversation).map((number) =>
    parseSession(record.conversation, number, recordIndex),
  )
  const sessions = parsedSessions.flatMap(({ session }) => (session === null ? [] : [session]))
  const noSessions =
    parsedSessions.length === 0
      ? [semanticIssue(`$[${recordIndex}].conversation`, 'must contain at least one session_n field', recordIndex)]
      : []
  return {
    sessions,
    issues: [
      ...speakerA.issues,
      ...speakerB.issues,
      ...unknownConversationIssues(record.conversation, recordIndex),
      ...orphanTimestampIssues(record.conversation, recordIndex),
      ...parsedSessions.flatMap(({ issues }) => issues),
      ...turnSpeakerIssues(sessions, [speakerA.value, speakerB.value], recordIndex),
      ...noSessions,
    ],
  }
}

const duplicateIssues = (
  values: readonly string[],
  path: string,
  recordIndex: number,
): readonly PublicImportIssue[] => {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    if (seen.has(value)) {
      return [semanticIssue(path, `duplicate official id: ${value}`, recordIndex)]
    }
    seen.add(value)
    return []
  })
}

const referenceIssues = (
  record: LocomoRecord,
  dialogIds: ReadonlySet<string>,
  recordIndex: number,
): readonly PublicImportIssue[] =>
  record.qa.flatMap((question, questionIndex) =>
    question.evidence.flatMap((dialogId, evidenceIndex) =>
      dialogIds.has(dialogId)
        ? []
        : [
            semanticIssue(
              `$[${recordIndex}].qa[${questionIndex}].evidence[${evidenceIndex}]`,
              `official dialog evidence does not exist: ${dialogId}`,
              recordIndex,
            ),
          ],
    ),
  )

export const parseLocomo = (value: unknown): CaseValidationResult => {
  const parsed = datasetSchema.safeParse(value)
  if (!parsed.success) return rejectedCases('invalid_shape', issuesFromZod(parsed.error))
  if (parsed.data.length !== 10) {
    return rejectedCases('invalid_revision', [
      semanticIssue('$', `locomo-10-v1 requires exactly 10 records; received ${parsed.data.length}`, null),
    ])
  }

  const details = parsed.data.map(conversationDetails)
  const semanticIssues = parsed.data.flatMap((record, recordIndex) => {
    const sessions = details[recordIndex]?.sessions ?? []
    const dialogIds = sessions.flatMap(({ turns }) => turns.map(({ dia_id: dialogId }) => dialogId))
    return [
      ...(details[recordIndex]?.issues ?? []),
      ...duplicateIssues(dialogIds, `$[${recordIndex}].conversation`, recordIndex),
      ...referenceIssues(record, new Set(dialogIds), recordIndex),
    ]
  })
  const sampleIdIssues = duplicateIssues(
    parsed.data.map(({ sample_id: sampleId }) => sampleId),
    '$',
    0,
  ).map((issue) => ({ ...issue, recordIndex: null }))
  const issues = [...semanticIssues, ...sampleIdIssues]
  return issues.length > 0
    ? rejectedCases('invalid_reference', issues)
    : acceptedCases(
        parsed.data.map((record, index) => normalizeLocomoRecord(record, index, details[index]?.sessions ?? [])),
      )
}
