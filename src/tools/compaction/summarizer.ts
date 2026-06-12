// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText } from 'ai'

import { resolveEffectiveLlmConfig } from '../../llm-config-resolver.js'
import { buildChatModel } from '../../llm-model-builder.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'compaction:summarizer' })

const PROMPT_INPUT_BUDGET = 12_000

const SYSTEM = [
  'You compress a large tool result into a concise, faithful summary for an AI agent.',
  'Keep only what is relevant to the user intent and the tool that produced it.',
  'Preserve concrete identifiers, counts, names, and statuses the agent will need.',
  'Do not invent data. Output prose only, no preamble.',
].join(' ')

export interface SummarizerDeps {
  generate: (opts: { system: string; prompt: string }) => Promise<{ text: string }>
}

export interface SummarizeInput {
  serialized: string
  totalBytes: number
  toolName: string
  userIntent: string
}

/** Resolves per-context (BYOK-aware) credentials once; callers should build this once per turn. */
export function buildSummarizerDeps(configContextId: string): SummarizerDeps | null {
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (!resolved.ok) return null
  const model = buildChatModel(resolved.llmApiKey, resolved.llmBaseUrl, resolved.smallModel)
  return {
    generate: async (opts) => {
      const result = await generateText({ model, system: opts.system, prompt: opts.prompt })
      return { text: result.text }
    },
  }
}

export async function summarizeResult(
  input: SummarizeInput,
  deps: SummarizerDeps | null,
): Promise<{ summary: string | null }> {
  if (deps === null) return { summary: null }

  const slice = input.serialized.slice(0, PROMPT_INPUT_BUDGET)
  const prompt = [
    `Tool: ${input.toolName}`,
    `User intent: ${input.userIntent}`,
    `Total bytes: ${input.totalBytes}`,
    'Result (possibly truncated):',
    slice,
  ].join('\n')

  try {
    const { text } = await deps.generate({ system: SYSTEM, prompt })
    const trimmed = text.trim()
    return { summary: trimmed === '' ? null : trimmed }
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error), tool: input.toolName },
      'Summarize failed',
    )
    return { summary: null }
  }
}
