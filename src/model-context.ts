// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

/** Approximate context-window sizes (in tokens) keyed by model-name prefix. */
const MODEL_CONTEXT_WINDOWS: ReadonlyArray<readonly [prefix: string, tokens: number]> = [
  // OpenAI GPT-4.1 family (1M context)
  ['gpt-4.1-nano', 1_048_576],
  ['gpt-4.1-mini', 1_048_576],
  ['gpt-4.1', 1_048_576],
  // OpenAI GPT-4o family
  ['gpt-4o-mini', 128_000],
  ['gpt-4o', 128_000],
  ['gpt-4-turbo', 128_000],
  // OpenAI o-series reasoning models
  ['o4-mini', 200_000],
  ['o3-mini', 200_000],
  ['o1-preview', 128_000],
  ['o1-mini', 128_000],
  ['o1', 200_000],
  // Anthropic Claude 4 family
  ['claude-haiku-4-5', 200_000],
  ['claude-sonnet-4', 200_000],
  ['claude-opus-4', 200_000],
  // Google Gemini family (1M+ context)
  ['gemini-2.5-pro', 1_048_576],
  ['gemini-2.0-flash', 1_048_576],
  ['gemini-1.5-pro', 2_097_152],
  ['gemini-1.5-flash', 1_048_576],
  // Deepseek family
  ['deepseek-reasoner', 64_000],
  ['deepseek-chat', 64_000],
  // Meta Llama family
  ['llama-3.3-70b', 128_000],
  ['llama-3.2-90b', 128_000],
  ['llama-3.2-11b', 128_000],
  ['llama-3.2-3b', 128_000],
  ['llama-3.2-1b', 128_000],
  ['llama-3.1-405b', 128_000],
  ['llama-3.1-70b', 128_000],
  ['llama-3.1-8b', 128_000],
  // Mistral family
  ['mistral-large', 128_000],
  ['mistral-medium', 32_000],
  ['mistral-small', 32_000],
  ['mixtral-8x22b', 65_536],
  ['mixtral-8x7b', 32_000],
]

/** Resolve a model's context-window size in tokens, or null when the model is unknown. */
export const resolveMaxTokens = (modelName: string): number | null => {
  for (const [prefix, tokens] of MODEL_CONTEXT_WINDOWS) {
    if (modelName.startsWith(prefix)) return tokens
  }
  return null
}

/**
 * Cheap, dependency-free token estimate (~4 characters per token). Accurate enough for
 * trim-trigger thresholds; the precise tokenizer (`context-tokenizer.ts`) is reserved for
 * the `/context` display surface.
 */
export const estimateTokens = (text: string): number => {
  if (text.length === 0) return 0
  return Math.ceil(text.length / 4)
}

const serializeMessage = (message: ModelMessage): string => {
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  return `${message.role}: ${content}`
}

/** Estimate the token footprint of a serialized message list. */
export const estimateMessagesTokens = (messages: readonly ModelMessage[]): number =>
  estimateTokens(messages.map(serializeMessage).join('\n'))
