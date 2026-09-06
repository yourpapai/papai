// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import { getDictionary, type Locale } from '../i18n/index.js'
import { logger } from '../logger.js'
import { isToolFailureResult } from '../tool-failure.js'

const log = logger.child({ scope: 'completion:verified' })

const READ_ONLY_PREFIXES = ['get_', 'list_', 'search_', 'read_'] as const

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

/** True when the turn executed at least one tool: any tool message carries a tool-result part. */
export const turnHasToolActivity = (messages: readonly ModelMessage[]): boolean => {
  for (const message of messages) {
    if (message.role !== 'tool') continue
    if (message.content.some((part) => part.type === 'tool-result')) return true
  }
  return false
}

export type CompletionVerdict = 'confirmed' | 'truncated' | 'partial' | 'unconfirmed' | 'no-op'
/** How the verification pass itself went: produced text, returned blank, or threw. */
export type VerifierOutcome = 'ok' | 'empty' | 'error'
export type VerifiedCompletion = {
  text: string
  verdict: CompletionVerdict
  verifierOutcome: VerifierOutcome
}
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
  /** True when the turn executed at least one tool; the call sites fill it from the messages they collect. */
  hadToolActivity: boolean
  /** The turn's own final model text; undefined when the model produced none. */
  finalText?: string
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

/**
 * Derive the verdict from observable turn shape (design D2 order):
 * truncated (pending tool call) → partial (tool failure) → no-op (empty final
 * text with no executed tool) → confirmed.
 */
export const deriveVerdict = (turn: CompletionTurn): CompletionVerdict => {
  if (turn.finishReason === 'tool-calls') return 'truncated'
  if (turn.hadToolFailure) return 'partial'
  if (!turn.hadToolActivity && (turn.finalText === undefined || turn.finalText === '')) return 'no-op'
  return 'confirmed'
}

/**
 * On a risky turn, run a verification LLM call and return a truthful user-facing message.
 * Never returns a bare "Done."; when verification degrades (verifier empty or throwing) it
 * delivers the model's own final text when there is one, keeping the derived verdict, and
 * falls back to the honest last-resort message — actions-ran vs nothing-executed, selected
 * by the turn's tool activity — only when the model produced no text.
 */
export const buildVerifiedCompletion = async (
  turn: CompletionTurn,
  deps: VerifierDeps,
): Promise<VerifiedCompletion> => {
  const verdict = deriveVerdict(turn)
  const texts = getDictionary(turn.locale ?? 'en').completion
  const lastResortFallback = turn.hadToolActivity ? texts.neutralFallback : texts.noopFallback
  log.debug({ verdict, readBack: deps.readOnlyToolset !== undefined }, 'Building verified completion')
  const prompt = buildVerifierPrompt(turn)
  const degradedCompletion = (outcome: VerifierOutcome, event: string, err?: string): VerifiedCompletion => {
    const finalText = turn.finalText
    if (finalText !== undefined && finalText.trim() !== '') {
      log.warn({ verdict, delivered: 'model-final-text', verifierOutcome: outcome, err }, event)
      return { text: finalText, verdict, verifierOutcome: outcome }
    }
    log.warn({ verdict, delivered: 'last-resort-fallback', verifierOutcome: outcome, err }, event)
    return { text: lastResortFallback, verdict: 'unconfirmed', verifierOutcome: outcome }
  }
  try {
    const res = await deps.invokeVerifier(prompt)
    if (res.text === undefined || res.text.trim() === '') {
      return degradedCompletion('empty', 'Verifier returned empty text')
    }
    log.info({ verdict }, 'Verified completion built')
    return { text: res.text, verdict, verifierOutcome: 'ok' }
  } catch (error) {
    return degradedCompletion('error', 'Verifier call failed', error instanceof Error ? error.message : String(error))
  }
}
