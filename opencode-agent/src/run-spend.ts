// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { loadDb as loadModelsDb, resolveCost } from '../../sdd-runner/src/pricing.js'
import type { ModelsDevDb, ResolvedCost } from '../../sdd-runner/src/pricing.js'
import { costOfUsage } from '../../sdd-runner/src/usage-aggregate.js'
import type { UsageBuckets } from '../../sdd-runner/src/usage-aggregate.js'
import type { Logger } from './logger.js'
import { modelRef } from './openai-config.js'
import type { OpenAiSettings } from './openai-config.js'
import { errorMessage } from './types.js'

/**
 * What a run cost, decided on a ladder whose bottom rung is "nobody knows".
 *
 * The reason this is not one line of arithmetic is recorded in `types.ts`:
 * OpenCode's own cost figure reads **0** for any model its catalogue does not
 * price, which — for a pipeline whose whole point is an arbitrary configured
 * model — is the ordinary case. A `0` that reads as a real figure is worse than
 * no figure, so unknown is a rung here rather than a fallback value.
 *
 * Strictly downstream of the token ceiling, and that separation is load-bearing
 * rather than tidy: `token-budget.ts` enforces on tokens precisely because they
 * are always right, and a guardrail that could fail to price a model would be a
 * guardrail that silently stops bounding it. This module may answer `null`; the
 * budget may not.
 *
 * The arithmetic itself is `sdd-runner`'s, imported rather than copied — the
 * edge `model-metadata.ts` already opened, for the reason it records there: one
 * direction, a function wide, both workspaces developer tooling outside papai's
 * runtime.
 */

/**
 * Which rung answered, reported so a run log explains its own figure.
 *
 * `unspent` is not a rung: it is the case where nothing needed pricing because
 * the model was never asked anything. It exists because `none` must keep
 * meaning "could not be priced" — this module's whole reason for being is that
 * a `0` standing in for unknown is worse than no figure, and a run that was
 * stopped before it prompted has a `0` that is simply true. Reusing `none` for
 * it made every over-budget stop report the issue's exact total as a lower
 * bound, on issues whose every turn had been priced.
 */
export type CostSource = 'backend' | 'catalogue' | 'none' | 'unspent'

export interface RunCost {
  /** The figure, or `null` when no rung could price the run. Never `0` for unknown. */
  readonly usd: number | null
  readonly source: CostSource
}

export interface RunCostInput {
  /**
   * What the backend said it cost, when it said anything.
   *
   * `0` and `undefined` both fall through, and deliberately so: OpenCode reports
   * a literal `0` for an unpriced model, so treating `0` as an answer would pin
   * exactly the wrong figure. A genuinely free run reaches `$0` through the
   * catalogue rung instead, having actually been priced.
   */
  readonly backendUsd?: number
  readonly buckets: UsageBuckets
  /** Names the model the catalogue is asked about, as `<provider>/<model>`. */
  readonly settings: OpenAiSettings
}

export interface RunCostDeps {
  readonly log: Logger
  /** Injection seam for tests; defaults to the cached, bounded models.dev read. */
  readonly loadDb?: () => Promise<ModelsDevDb>
}

const UNPRICED: RunCost = { usd: null, source: 'none' }

/**
 * The catalogue's price for a model, or `null` — the second swallow, and the
 * reason it is separate from {@link catalogue} is that it fails differently.
 *
 * `resolveCost` **throws** on a reference it cannot split into provider and
 * model, and a throw escaping here would take the phase with it. That is the one
 * thing this module must never do: a run's cost is a decoration on the work, and
 * a decoration does not get to fail it. `modelRef` composes the reference from
 * config, so an unsplittable one means a misconfigured provider — a real
 * possibility, and one whose punishment should be a missing figure rather than a
 * dead run.
 *
 * `resolveCost` also falls back across providers by bare model id and reports
 * which tier answered. Both tiers fold into `'catalogue'` at the call site: the
 * distinction between an exact row and a cross-provider median is real, and it
 * is detail for the log line rather than for a run comment.
 */
const priceOf = (reference: string, db: ModelsDevDb, deps: RunCostDeps): ResolvedCost | null => {
  try {
    return resolveCost(reference, db)
  } catch (error) {
    deps.log.warn(
      { model: reference, error: errorMessage(error) },
      'Could not look this model up in the catalogue; this run reports unpriced',
    )
    return null
  }
}

/**
 * Whether these counts can be priced at all.
 *
 * An optional bucket is absent when the backend did not report it, which is not
 * the same as reporting none — `sdk-contract.ts` keeps the two apart for this
 * one caller. Pricing the buckets that did arrive would under-charge a
 * cache-heavy run while looking exact, so a missing bucket fails the whole
 * reprice: `treeSpend`'s doctrine one workspace over, where absent usage makes
 * the ledger read unknown rather than `$0` of headroom.
 */
const priceable = (buckets: UsageBuckets): boolean =>
  buckets.reasoning !== undefined && buckets.cacheRead !== undefined && buckets.cacheWrite !== undefined

/**
 * The catalogue, or `null` — the only function here permitted to swallow.
 *
 * Best-effort is a property of one function rather than a convention at each
 * call site, which is this workspace's rule for every channel that degrades
 * (`model-metadata.ts` records it for the same reader). `loadModelsDb` already
 * answers `{}` for an unreachable host, so a miss and an outage arrive here
 * alike; a rejection is the case it does not cover.
 */
const catalogue = async (deps: RunCostDeps): Promise<ModelsDevDb | null> => {
  try {
    return await (deps.loadDb ?? loadModelsDb)()
  } catch (error) {
    deps.log.warn({ error: errorMessage(error) }, 'Could not read the model catalogue; this run reports unpriced')
    return null
  }
}

/**
 * Prices one run, most authoritative rung first.
 *
 * ```
 * ① the backend's own figure      non-zero → 'backend'
 *        ↓ (zero, or never reported)
 * ② the counts × the catalogue    priced row → 'catalogue'
 *        ↓ (no priced row, unreadable catalogue, or a bucket the backend never reported)
 * ③ unpriced                      usd: null → 'none'
 * ```
 *
 * Rung ① is first because it is the provider's own arithmetic over its own
 * counts — and on the claude route it is the only rung that sees a turn's
 * per-model split, which a single model reference cannot reproduce.
 */
export const resolveRunCost = async (input: RunCostInput, deps: RunCostDeps): Promise<RunCost> => {
  const reference = modelRef(input.settings)

  if (input.backendUsd !== undefined && input.backendUsd > 0) {
    deps.log.debug({ model: reference, source: 'backend' }, 'Priced this run')
    return { usd: input.backendUsd, source: 'backend' }
  }

  if (!priceable(input.buckets)) {
    deps.log.warn({ model: reference }, 'The backend reported no complete token split; this run reports unpriced')
    return UNPRICED
  }

  const db = await catalogue(deps)
  if (db === null) return UNPRICED

  const cost = priceOf(reference, db, deps)
  if (cost === null) {
    deps.log.warn({ model: reference }, 'No catalogue row prices this model; this run reports unpriced')
    return UNPRICED
  }

  deps.log.debug({ model: reference, source: 'catalogue', tier: cost.source }, 'Priced this run')
  return { usd: costOfUsage(input.buckets, cost), source: 'catalogue' }
}
