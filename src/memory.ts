// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText, type LanguageModel, type ModelMessage } from 'ai'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { getCachedFacts, getCachedSummary, setCachedSummary, clearCachedFacts, upsertCachedFact } from './cache.js'
import { getDrizzleDb } from './db/drizzle.js'
import { memorySummary, memoryFacts } from './db/schema.js'
import { logger } from './logger.js'
import { resolveTrimmedIndices } from './memory-tool-pairing.js'
import type { MemoryFact } from './types/memory.js'

const log = logger.child({ scope: 'memory' })

// --- Summary persistence (now uses cache) ---

export function loadSummary(userId: string): string | null {
  log.debug({ userId }, 'loadSummary called')
  return getCachedSummary(userId)
}

export function saveSummary(userId: string, summary: string): void {
  log.debug({ userId, summaryLength: summary.length }, 'saveSummary called')
  setCachedSummary(userId, summary)
  log.info({ userId, summaryLength: summary.length }, 'Summary saved to cache (DB sync in background)')
}

export function clearSummary(userId: string): void {
  log.debug({ userId }, 'clearSummary called')
  setCachedSummary(userId, '')

  const db = getDrizzleDb()
  db.delete(memorySummary).where(eq(memorySummary.userId, userId)).run()

  log.info({ userId }, 'Summary cleared')
}

// --- Fact persistence (now uses cache) ---

export function loadFacts(userId: string): readonly MemoryFact[] {
  log.debug({ userId }, 'loadFacts called')
  return getCachedFacts(userId)
}

export function upsertFact(userId: string, fact: Omit<MemoryFact, 'last_seen'>): void {
  log.debug({ userId, identifier: fact.identifier }, 'upsertFact called')
  upsertCachedFact(userId, fact)
  log.info({ userId, identifier: fact.identifier }, 'Fact upserted to cache (DB sync in background)')
}

export function clearFacts(userId: string): void {
  log.debug({ userId }, 'clearFacts called')
  clearCachedFacts(userId)

  const db = getDrizzleDb()
  db.delete(memoryFacts).where(eq(memoryFacts.userId, userId)).run()

  log.info({ userId }, 'Facts cleared')
}

const TaskResultSchema = z.looseObject({
  id: z.string(),
  title: z.string().optional(),
  number: z.number().optional(),
})

const ProjectResultSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
})

type SdkToolCall = Readonly<{ toolName: string; input: unknown }>
type SdkToolResult = Readonly<{ toolName: string; output: unknown }>
type ExtractedFact = Omit<MemoryFact, 'last_seen'>

const valueOrEmpty = (value: string | undefined): string => {
  if (value === undefined) return ''
  return value
}
const valueOrLabel = (value: string | undefined, label: string): string => {
  if (value === undefined) return label
  return value
}
const summaryOrPlaceholder = (value: string | null): string => {
  if (value === null) return '(none)'
  return value
}
const depsOrDefault = (deps: MemoryDeps | undefined): MemoryDeps => {
  if (deps === undefined) return defaultMemoryDeps
  return deps
}

function extractProjectsFromListResult(output: unknown): ExtractedFact[] {
  if (!Array.isArray(output)) return []

  return output.slice(0, 10).flatMap((project) => {
    const parsed = ProjectResultSchema.safeParse(project)
    if (!parsed.success) return []
    const url = valueOrEmpty(parsed.data.url)
    return [{ identifier: `proj:${parsed.data.id}`, title: parsed.data.name, url }]
  })
}

const extractFactsFromToolResult = (toolName: string, output: unknown): readonly ExtractedFact[] => {
  if (['create_task', 'update_task', 'delete_task', 'get_task'].includes(toolName)) {
    const parsed = TaskResultSchema.safeParse(output)
    if (!parsed.success) return []

    const label = parsed.data.number === undefined ? parsed.data.id : `#${parsed.data.number}`
    const title = valueOrLabel(parsed.data.title, label)
    return [{ identifier: label, title, url: '' }]
  }

  if (['create_project', 'update_project'].includes(toolName)) {
    const parsed = ProjectResultSchema.safeParse(output)
    if (!parsed.success) return []
    const url = valueOrEmpty(parsed.data.url)

    return [{ identifier: `proj:${parsed.data.id}`, title: parsed.data.name, url }]
  }

  if (toolName === 'list_projects') return extractProjectsFromListResult(output)

  return []
}

export function extractFactsFromSdkResults(
  toolCalls: SdkToolCall[],
  toolResults: SdkToolResult[],
): readonly ExtractedFact[] {
  void toolCalls
  return toolResults.flatMap((result) => extractFactsFromToolResult(result.toolName, result.output))
}

// --- Smart trimming with memory model ---

const TrimResultSchema = z.object({
  keep_indices: z.array(z.number().int()),
  summary: z.string(),
})

type TrimResult = {
  readonly trimmedMessages: readonly ModelMessage[]
  readonly summary: string
}

const TRIM_PROMPT = `You are a conversation memory manager. The following conversation history has grown too long ({TOTAL} messages).

Your task:
1. Select between 50 and 100 message indices (0-based) to retain verbatim. Choose fewer (~50) when many threads are resolved and the history is repetitive. Choose more (~100) when conversations are active and many topics are still open. Prefer messages about active unresolved tasks and projects, recent decisions, ongoing threads, and stated preferences. Drop messages about completed tasks, resolved clarifications, and abandoned threads.
2. Write an updated summary (max 200 words) for all messages NOT retained. Incorporate the previous summary. Preserve: task IDs and numbers, project names, decisions, priorities, preferences.

Previous summary:
{PREVIOUS_SUMMARY}

Conversation (index: [role] content):
{MESSAGES}

Return ONLY a raw JSON object (no markdown, no code fences) with this exact structure:
{"keep_indices": [<list of integer indices>], "summary": "<summary text>"}`

const parseModelResponse = (text: string): z.infer<typeof TrimResultSchema> => {
  const jsonMatch = text.match(/\{[\s\S]*\}/u)
  let rawOutput: unknown = null
  if (jsonMatch !== null) {
    try {
      rawOutput = JSON.parse(jsonMatch[0])
    } catch {
      // safeParse below will handle the null and produce a useful error
    }
  }
  const parsed = TrimResultSchema.safeParse(rawOutput)
  if (!parsed.success) {
    throw new Error(`Memory model returned invalid response: ${parsed.error.message}`)
  }
  return parsed.data
}

export interface MemoryDeps {
  generateText: typeof generateText
}

const defaultMemoryDeps: MemoryDeps = {
  generateText: (...args) => generateText(...args),
}

// Cap each message's serialized content in the trim prompt so a single huge message
// (e.g. a pasted document or a base64 attachment in a tool result) cannot overflow the
// small model's own context window or waste tokens.
const MAX_TRIM_MESSAGE_CHARS = 2_000

/** Render history as the indexed `index: [role] content` block fed to the trim model, with per-message truncation. */
export const serializeHistoryForTrimPrompt = (history: readonly ModelMessage[]): string =>
  history
    .map((m, i) => {
      const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      const content = raw.length > MAX_TRIM_MESSAGE_CHARS ? `${raw.slice(0, MAX_TRIM_MESSAGE_CHARS)}… [truncated]` : raw
      return `${i}: [${m.role}] ${content}`
    })
    .join('\n')

export async function trimWithMemoryModel(
  history: readonly ModelMessage[],
  trimMin: number,
  trimMax: number,
  previousSummary: string | null,
  model: LanguageModel,
  ...depsInput: readonly [] | readonly [MemoryDeps]
): Promise<TrimResult> {
  log.debug(
    { messageCount: history.length, trimMin, trimMax, hasPrevious: previousSummary !== null },
    'trimWithMemoryModel called',
  )

  const messagesText = serializeHistoryForTrimPrompt(history)

  const summaryText = summaryOrPlaceholder(previousSummary)
  const resolvedDeps = depsOrDefault(depsInput[0])
  const prompt = TRIM_PROMPT.replaceAll('{TOTAL}', String(history.length))
    .replace('{PREVIOUS_SUMMARY}', summaryText)
    .replace('{MESSAGES}', messagesText)

  const result = await resolvedDeps.generateText({
    model,
    prompt,
    timeout: 1_200_000,
  })

  const data = parseModelResponse(result.text)

  const selected = resolveTrimmedIndices(history, data.keep_indices, trimMin, trimMax)
  const trimmedMessages = selected.map((i) => history[i]!)

  log.info(
    {
      retained: trimmedMessages.length,
      dropped: history.length - trimmedMessages.length,
      summaryLength: data.summary.length,
    },
    'Memory model trim complete',
  )

  return { trimmedMessages, summary: data.summary }
}

// --- Context message builder ---

export { buildMemoryContextMessage } from './memory-context-block.js'
