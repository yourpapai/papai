// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { loadDb as loadModelsDb, lookupModel } from '../../sdd-runner/src/pricing.js'
import type { ModelsDevDb } from '../../sdd-runner/src/pricing.js'
import type { Logger } from './logger.js'
import { modelRef, NO_MODEL_OVERRIDES } from './openai-config.js'
import type { ModelFacts, OpenAiSettings } from './openai-config.js'
import { errorMessage } from './types.js'

/**
 * Deciding what this pipeline can say about its own model, before OpenCode is
 * asked to resolve it.
 *
 * The problem this exists for is silent: OpenCode's `isOverflow` opens with
 * `if (model.limit.context === 0) return false`, so a model it cannot find in its
 * catalogue never auto-compacts — a long turn simply grows until the provider
 * refuses it, and nothing anywhere says why. `LLM_PROVIDER` fixes that for every
 * model models.dev carries; this module is the tail, where the id is a
 * self-hosted alias or a fine-tune that no catalogue has ever heard of.
 *
 * The reader is `sdd-runner/src/pricing.ts` — already a models.dev client with a
 * disk cache, a bounded fetch and two recorded incident fixes — rather than a
 * second copy of all that. The import crosses a workspace boundary in one
 * direction and one function wide; both workspaces are developer tooling outside
 * papai's runtime.
 */

/** Where a fact came from, reported so a run's log can be read without a rerun. */
export type FactsSource = 'override' | 'catalogue' | 'none'

/** What the resolution found, and which tier answered for the field that matters. */
export interface ResolvedFacts {
  facts: ModelFacts
  /**
   * The tier that supplied the **context window**, specifically.
   *
   * One field rather than one per fact, because one field is the one with a
   * silent failure: a missing `reasoning` costs an effort tier nobody asked for
   * yet, where a missing `context` costs every long turn in the run.
   */
  source: FactsSource
}

export interface ModelMetadataDeps {
  loadDb?: () => Promise<ModelsDevDb>
}

/**
 * The catalogue row, or `null` — and the only function here permitted to swallow.
 *
 * Best-effort has to be a property of one function rather than a convention at
 * each call site, which is this workspace's rule for every channel that degrades.
 * `loadModelsDb` already answers `{}` for an unreachable or unparseable host, so
 * a miss and an outage arrive here identically; the `warn` names the reference
 * either way, because the actionable fact for a reader is the same — nothing was
 * found, and the run is about to proceed on whatever OpenCode resolves alone.
 */
const catalogueEntry = async (
  reference: string,
  log: Logger,
  deps: ModelMetadataDeps,
): Promise<ReturnType<typeof lookupModel>> => {
  try {
    const entry = lookupModel(reference, await (deps.loadDb ?? loadModelsDb)())
    if (entry === null) {
      log.warn({ model: reference }, 'No catalogue row for this model; its limits and capabilities are undeclared')
    }
    return entry
  } catch (error) {
    log.warn({ model: reference, error: errorMessage(error) }, 'Could not read the model catalogue')
    return null
  }
}

/**
 * Which tier answered for the context window.
 *
 * Its own function rather than a nested ternary, because the three outcomes are
 * the three rungs of the ladder below and reading them as such is the point.
 */
const contextSource = (declared: number | null, catalogued: number | undefined): FactsSource => {
  if (declared !== null) return 'override'
  if (catalogued === undefined) return 'none'
  return 'catalogue'
}

/**
 * Resolves what this run knows about its model, most explicit tier first.
 *
 * ```
 * AGENT_MODEL_CONTEXT / _OUTPUT / _REASONING   an operator said so → always wins
 *         ↓ (unset)
 * models.dev row for <LLM_PROVIDER>/<LLM_MODEL>
 *         ↓ (miss, or the read failed)
 * nothing emitted            → OpenCode's own catalogue merge stays free to fill it
 *         ↓ (miss there too)
 * OpenCode's zero defaults   → compaction off, no effort variants
 * ```
 *
 * The bottom two rungs are why a resolved field is **omitted** rather than
 * written as a zero: emitting `limit: { context: 0 }` would *pin* the broken
 * value this whole change exists to stop producing, where an absent key leaves
 * OpenCode's own merge to answer.
 */
export const resolveModelFacts = async (
  settings: OpenAiSettings,
  log: Logger,
  deps: ModelMetadataDeps = {},
): Promise<ResolvedFacts> => {
  const overrides = settings.overrides ?? NO_MODEL_OVERRIDES
  const reference = modelRef(settings)
  const entry = await catalogueEntry(reference, log, deps)

  const context = overrides.context ?? entry?.limit?.context
  const output = overrides.output ?? entry?.limit?.output
  const reasoning = overrides.reasoning ?? entry?.reasoning

  const facts: ModelFacts = {
    // `limit` is emitted on the strength of `context` alone. The SDK's config type
    // requires both halves, and an unknown `output` is written as `0` — which
    // OpenCode's merge reads exactly as absent (`?? existingModel?.limit?.output ??
    // 0`) and `maxOutputTokens` falls back to its own 32k ceiling on. A `0`
    // *context* is nothing like that, which is why this is keyed on context.
    ...(context === undefined ? {} : { limit: { context, output: output ?? 0 } }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(entry?.tool_call === undefined ? {} : { tool_call: entry.tool_call }),
    ...(entry?.temperature === undefined ? {} : { temperature: entry.temperature }),
    ...(entry?.attachment === undefined ? {} : { attachment: entry.attachment }),
  }

  const source = contextSource(overrides.context, entry?.limit?.context)

  // The one line that answers "why did this run never compact" without a rerun.
  // Names and numbers only — a CI log is world-readable on a public repository.
  log.debug(
    { model: reference, context: context ?? null, reasoning: reasoning ?? null, source },
    'Resolved model facts',
  )

  return { facts, source }
}
