// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { EffectRecord } from './types.js'

/** Build the user-facing summary posted after a run is stopped. Deterministic, code-generated. */
export function buildStopSummary(effects: ReadonlyArray<EffectRecord>, opts: { forced: boolean }): string {
  const head = opts.forced ? '🛑 Stopped immediately.' : '🛑 Stopped.'
  const forcedTail = ' An in-flight action may have been cut off — verify recent changes.'

  if (effects.length === 0) {
    return opts.forced ? `${head}${forcedTail}` : `${head} No actions had been taken yet.`
  }

  const counts = new Map<string, number>()
  for (const effect of effects) counts.set(effect.toolName, (counts.get(effect.toolName) ?? 0) + 1)
  const parts = [...counts.entries()].map(([name, n]) => (n === 1 ? name : `${name} ×${n}`))
  const done = `Completed ${effects.length} action${effects.length === 1 ? '' : 's'}: ${parts.join(', ')}.`

  return opts.forced ? `${head} ${done}${forcedTail}` : `${head} ${done}`
}
