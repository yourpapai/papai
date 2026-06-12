// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText, type LanguageModel, type ModelMessage } from 'ai'
import { z } from 'zod'

import { serializeHistoryForTrimPrompt } from '../memory.js'
import { MemoryKindSchema, MemoryStatusSchema, type MemoryRecord, type MemoryEvidence } from './types.js'

const MAX_PROFILE_LENGTH = 4_000
const MAX_RECORDS_PER_PATCH = 20
const MAX_UPDATES_PER_PATCH = 50
const MAX_CONTENT_LENGTH = 2_000
const MAX_SUMMARY_LENGTH = 240
const MAX_TAGS_PER_RECORD = 12
const MAX_TAG_LENGTH = 48
const MAX_EVIDENCE_VALUES = 20
const MAX_EVIDENCE_VALUE_LENGTH = 512

const IsoTimestampSchema = z.iso.datetime().transform((value) => new Date(value).toISOString())
const EvidenceValueSchema = z.string().min(1).max(MAX_EVIDENCE_VALUE_LENGTH)

const MemoryEvidenceSchema: z.ZodType<MemoryEvidence> = z
  .object({
    messageIds: z.array(EvidenceValueSchema).max(MAX_EVIDENCE_VALUES).optional(),
    actorIds: z.array(EvidenceValueSchema).max(MAX_EVIDENCE_VALUES).optional(),
    timestamps: z.array(IsoTimestampSchema).max(MAX_EVIDENCE_VALUES).optional(),
    contextId: EvidenceValueSchema.optional(),
  })
  .readonly()

const MemoryPatchRecordSchema = z.object({
  kind: MemoryKindSchema,
  content: z.string().min(1).max(MAX_CONTENT_LENGTH),
  summary: z.string().min(1).max(MAX_SUMMARY_LENGTH).nullable(),
  tags: z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_RECORD),
  confidence: z.number().min(0).max(1),
  source: z.literal('background'),
  evidence: MemoryEvidenceSchema,
  expiresAt: IsoTimestampSchema.optional(),
  validFrom: IsoTimestampSchema.optional(),
  validUntil: IsoTimestampSchema.optional(),
})

const MemoryPatchUpdateSchema = z.object({
  id: z.string().min(1).max(256),
  status: MemoryStatusSchema.optional(),
  content: z.string().min(1).max(MAX_CONTENT_LENGTH).optional(),
  confidence: z.number().min(0).max(1).optional(),
})

export const MemoryPatchSchema = z.object({
  profile: z.string().min(1).max(MAX_PROFILE_LENGTH).nullable(),
  records: z.array(MemoryPatchRecordSchema).max(MAX_RECORDS_PER_PATCH),
  updates: z.array(MemoryPatchUpdateSchema).max(MAX_UPDATES_PER_PATCH),
})

export type MemoryPatch = z.infer<typeof MemoryPatchSchema>

export type ExtractMemoryPatchInput = Readonly<{
  history: readonly ModelMessage[]
  profile: string | null
  records: readonly MemoryRecord[]
  model: LanguageModel
}>

export type ExtractMemoryPatchDeps = Readonly<{
  generateText: typeof generateText
}>

const defaultDeps: ExtractMemoryPatchDeps = {
  generateText: (...args) => generateText(...args),
}

const jsonObjectFromText = (text: string): string => {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('no JSON object found')

  const initialState = {
    depth: 0,
    inString: false,
    escaped: false,
    end: -1,
  }
  const result = Array.from(text.slice(start)).reduce((state, char, offset) => {
    if (state.end !== -1) return state
    if (state.escaped) return { ...state, escaped: false }
    if (char === '\\' && state.inString) return { ...state, escaped: true }
    if (char === '"') return { ...state, inString: !state.inString }
    if (state.inString) return state
    if (char === '{') return { ...state, depth: state.depth + 1 }
    if (char !== '}') return state
    const depth = state.depth - 1
    return depth === 0 ? { ...state, depth, end: start + offset + 1 } : { ...state, depth }
  }, initialState)

  if (result.end === -1) throw new Error('unterminated JSON object')
  return text.slice(start, result.end)
}

export function parseMemoryPatch(text: string): MemoryPatch {
  try {
    const raw = JSON.parse(jsonObjectFromText(text)) as unknown
    return MemoryPatchSchema.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid memory patch: ${message}`, { cause: error })
  }
}

const recordsForPrompt = (records: readonly MemoryRecord[]): string =>
  JSON.stringify(
    records.map((record) => ({
      id: record.id,
      kind: record.kind,
      summary: record.summary,
      tags: record.tags,
      confidence: record.confidence,
      status: record.status,
      lastSeenAt: record.lastSeenAt,
    })),
  )

const EXTRACTION_PROMPT = `You are papai's long-term memory extractor.

Return ONLY a raw JSON object with this exact shape:
{"profile": string|null, "records": [{"kind": "...", "content": "...", "summary": string|null, "tags": string[], "confidence": 0.0, "source": "background", "evidence": {}}], "updates": [{"id": "...", "status": "active|stale|archived|contradicted", "content": "...", "confidence": 0.0}]}

Rules:
- Capture only durable user or group preferences, stable facts, decisions, procedures, project context, person context, episodes, and references.
- Avoid over-capturing routine chat, transient requests, guesses, secrets, credentials, tokens, private sensitive data, or anything the user would not reasonably expect to be remembered.
- Preserve timestamps, message ids, actors, and context ids in evidence when present in the conversation.
- Use "background" as the source for new records inferred from this conversation.
- Use updates only for existing record ids listed below, and never invent ids.
- If nothing should change, return {"profile":null,"records":[],"updates":[]}.

Current profile:
{PROFILE}

Existing active records:
{RECORDS}

Conversation:
{HISTORY}`

export async function extractMemoryPatch(
  input: ExtractMemoryPatchInput,
  deps: ExtractMemoryPatchDeps = defaultDeps,
): Promise<MemoryPatch> {
  const prompt = EXTRACTION_PROMPT.replace('{PROFILE}', input.profile ?? '(none)')
    .replace('{RECORDS}', recordsForPrompt(input.records))
    .replace('{HISTORY}', serializeHistoryForTrimPrompt(input.history))
  const result = await deps.generateText({
    model: input.model,
    prompt,
    timeout: 1_200_000,
  })
  return parseMemoryPatch(result.text)
}
