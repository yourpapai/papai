// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { t, type Locale } from '../i18n/index.js'
import type { EffectRecord } from './types.js'

/** Build the user-facing summary posted after a run is stopped. Deterministic, code-generated. */
export function buildStopSummary(
  effects: ReadonlyArray<EffectRecord>,
  opts: { forced: boolean; locale?: Locale },
): string {
  const locale = opts.locale ?? 'en'
  const head = t(opts.forced ? 'orchestrator.stopSummaryHeadForced' : 'orchestrator.stopSummaryHead', locale)
  const forcedTail = t('orchestrator.stopSummaryForcedTail', locale)

  if (effects.length === 0) {
    return opts.forced ? `${head} ${forcedTail}` : `${head} ${t('orchestrator.stopSummaryNoActions', locale)}`
  }

  const counts = new Map<string, number>()
  for (const effect of effects) counts.set(effect.toolName, (counts.get(effect.toolName) ?? 0) + 1)
  const parts = [...counts.entries()].map(([name, n]) => (n === 1 ? name : `${name} ×${n}`))
  const done = t(
    effects.length === 1 ? 'orchestrator.stopSummaryDoneOne' : 'orchestrator.stopSummaryDoneMany',
    locale,
    { count: effects.length, list: parts.join(', ') },
  )

  return opts.forced ? `${head} ${done} ${forcedTail}` : `${head} ${done}`
}
