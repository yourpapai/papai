// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText, type LanguageModel, type ModelMessage } from 'ai'
import { z } from 'zod'

import { serializeHistoryForTrimPrompt } from '../memory.js'
import {
  MemoryKindSchema,
  MemorySourceSchema,
  MemoryStatusSchema,
  type MemoryRecord,
  type MemoryEvidence,
} from './types.js'

const MemoryEvidenceSchema: z.ZodType<MemoryEvidence> = z
  .object({
    messageIds: z.array(z.string()).optional(),
    actorIds: z.array(z.string()).optional(),
    timestamps: z.array(z.string()).optional(),
    contextId: z.string().optional(),
  })
  .readonly()

const MemoryPatchRecordSchema = z.object({
  kind: MemoryKindSchema,
  content: z.string().min(1),
  summary: z.string().nullable(),
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  source: MemorySourceSchema,
  evidence: MemoryEvidenceSchema,
  expiresAt: z.string().optional(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
})

const MemoryPatchUpdateSchema = z.object({
  id: z.string().min(1),
  status: MemoryStatusSchema.optional(),
  content: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
})

export const MemoryPatchSchema = z.object({
  profile: z.string().nullable(),
  records: z.array(MemoryPatchRecordSchema),
  updates: z.array(MemoryPatchUpdateSchema),
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
