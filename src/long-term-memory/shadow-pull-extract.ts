// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { ResolvedStreamTextResult } from '../llm-orchestrator-events.js'

const SEARCH_MEMORY_TOOL_NAME = 'search_memory'

const searchMemoryInputSchema = z.object({ query: z.string() })

const searchMemoryOutputSchema = z.object({ records: z.array(z.unknown()) }).loose()

const recordIdSchema = z.object({ id: z.string() }).loose()

/** What the model's own `search_memory` tool calls surfaced this turn, extracted from `result.steps`. */
export type ExtractedShadowPull = Readonly<{
  pulled: boolean
  pullCount: number
  queries: readonly string[]
  resultIds: readonly string[]
}>

function extractQuery(input: unknown): string | undefined {
  const parsed = searchMemoryInputSchema.safeParse(input)
  return parsed.success ? parsed.data.query : undefined
}

function extractResultIds(output: unknown): readonly string[] {
  const parsed = searchMemoryOutputSchema.safeParse(output)
  if (!parsed.success) return []

  const ids: string[] = []
  for (const record of parsed.data.records) {
    const parsedRecord = recordIdSchema.safeParse(record)
    if (parsedRecord.success) ids.push(parsedRecord.data.id)
  }
  return ids
}

/**
 * Walks a resolved turn's `steps` for `search_memory` tool calls, pairing each call's
 * input query with its result via `toolCallId`. Pure, no I/O; tolerant of missing or
 * malformed tool call/result shapes — unknown shapes yield empty ids, never a throw.
 */
export function extractSearchMemoryPulls(steps: ResolvedStreamTextResult['steps']): ExtractedShadowPull {
  let pullCount = 0
  const queries: string[] = []
  const resultIds: string[] = []

  for (const step of steps) {
    const resultsByCallId = new Map(step.toolResults.map((toolResult) => [toolResult.toolCallId, toolResult.output]))
    for (const toolCall of step.toolCalls) {
      if (toolCall.toolName !== SEARCH_MEMORY_TOOL_NAME) continue

      pullCount += 1
      const query = extractQuery(toolCall.input)
      if (query !== undefined) queries.push(query)

      resultIds.push(...extractResultIds(resultsByCallId.get(toolCall.toolCallId)))
    }
  }

  return { pulled: pullCount > 0, pullCount, queries, resultIds }
}
