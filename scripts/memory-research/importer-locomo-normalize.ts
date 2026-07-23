// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LocomoRecord, LocomoSession } from './importer-locomo.js'
import type { NormalizedPublicCase } from './importer-types.js'

type OfficialAnswer = NormalizedPublicCase['questions'][number]['officialAnswers'][number]

const officialAnswer = (question: LocomoRecord['qa'][number]): OfficialAnswer =>
  'answer' in question ? question.answer : question.adversarial_answer

export const normalizeLocomoRecord = (
  record: LocomoRecord,
  recordIndex: number,
  sessions: readonly LocomoSession[],
): NormalizedPublicCase => {
  const evidenceIds = new Set(record.qa.flatMap(({ evidence }) => evidence))
  return {
    caseId: record.sample_id,
    sourceRecordIndex: recordIndex,
    category: 'locomo-conversation',
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      timestamp: session.timestamp,
      messages: session.turns.map((turn) => ({
        messageId: turn.dia_id,
        role: 'speaker',
        speaker: turn.speaker,
        content: turn.text,
        officialEvidence: evidenceIds.has(turn.dia_id),
      })),
    })),
    questions: record.qa.map((question, questionIndex) => ({
      questionId: `${record.sample_id}:qa:${questionIndex}`,
      text: question.question,
      timestamp: null,
      category: String(question.category),
      abstention: question.category === 5,
      officialAnswers: [officialAnswer(question)],
      officialChoices: null,
      officialEvidenceRefs: question.evidence,
      evidenceGranularity: 'dialog',
    })),
  }
}
