// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import { getDictionary, type Locale } from '../i18n/index.js'
import { logger } from '../logger.js'
import { isToolFailureResult } from '../tool-failure.js'

const log = logger.child({ scope: 'completion:verified' })

const READ_ONLY_PREFIXES = ['get_', 'list_', 'search_'] as const

/** Filter an assembled toolset to a read-only subset by name prefix. Returns undefined when none match. */
export const selectReadOnlyTools = (tools: ToolSet): ToolSet | undefined => {
  const entries = Object.entries(tools).filter(([name]) => READ_ONLY_PREFIXES.some((p) => name.startsWith(p)))
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

const containsToolFailure = (value: unknown): boolean => {
  if (isToolFailureResult(value)) return true
  if (Array.isArray(value)) return value.some(containsToolFailure)
  if (value !== null && typeof value === 'object') return Object.values(value).some(containsToolFailure)
  return false
}

/** True when any tool-result message in the turn carries a ToolFailureResult (scanned defensively). */
export const detectToolFailure = (messages: readonly ModelMessage[]): boolean => {
  for (const message of messages) {
    if (message.role !== 'tool') continue
    if (containsToolFailure(message.content)) return true
  }
  return false
}

export type CompletionVerdict = 'confirmed' | 'truncated' | 'partial' | 'failed' | 'unconfirmed'
export type VerifiedCompletion = { text: string; verdict: CompletionVerdict }
export type VerifierPrompt = { system: string; messages: ModelMessage[] }

export type VerifierDeps = {
  /** Runs the constrained second generateText call; returns its text + finishReason. */
  invokeVerifier: (prompt: VerifierPrompt) => Promise<{ text: string | undefined; finishReason?: string }>
  /** Present when read-back is possible (used only for the debug log; the closure binds the toolset itself). */
  readOnlyToolset: ToolSet | undefined
}

export type CompletionTurn = {
  history: readonly ModelMessage[]
  finishReason?: string
  hadToolFailure: boolean
  /** Locale of the turn's config context; the verifier prompt and fallback localize to it. */
  locale?: Locale
}

export const VERIFIER_MAX_STEPS = 4

const buildVerifierPrompt = (turn: CompletionTurn): VerifierPrompt => {
  const texts = getDictionary(turn.locale ?? 'en').completion
  const truncated = turn.finishReason === 'tool-calls'
  const system = texts.verifierSystem.replace(
    '{rule}',
    truncated ? texts.verifierTruncatedRule : texts.verifierSummarizeRule,
  )
  const messages: ModelMessage[] = [...turn.history, { role: 'user', content: texts.finalizeMessage }]
  return { system, messages }
}

const deriveVerdict = (turn: CompletionTurn): CompletionVerdict => {
  if (turn.finishReason === 'tool-calls') return 'truncated'
  if (turn.hadToolFailure) return 'partial'
  return 'confirmed'
}

/**
 * On a risky turn, run a verification LLM call and return a truthful user-facing message.
 * Never returns a bare "Done."; degrades to a neutral honest message if verification fails.
 */
export const buildVerifiedCompletion = async (
  turn: CompletionTurn,
  deps: VerifierDeps,
): Promise<VerifiedCompletion> => {
  const verdict = deriveVerdict(turn)
  const neutralFallback = getDictionary(turn.locale ?? 'en').completion.neutralFallback
  log.debug({ verdict, readBack: deps.readOnlyToolset !== undefined }, 'Building verified completion')
  const prompt = buildVerifierPrompt(turn)
  try {
    const res = await deps.invokeVerifier(prompt)
    if (res.text === undefined || res.text === '') {
      log.warn({ verdict }, 'Verifier returned empty text; using neutral fallback')
      return { text: neutralFallback, verdict: 'unconfirmed' }
    }
    log.info({ verdict }, 'Verified completion built')
    return { text: res.text, verdict }
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'Verifier call failed; using neutral fallback',
    )
    return { text: neutralFallback, verdict: 'unconfirmed' }
  }
}
