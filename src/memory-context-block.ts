// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MemoryFact } from './types/memory.js'

const DAY_MS = 24 * 60 * 60 * 1000
// Entities not touched within this window are flagged stale; past the eviction window
// they drop out of the rendered block entirely. At most this many are shown.
const STALE_AFTER_MS = 14 * DAY_MS
const EVICT_AFTER_MS = 45 * DAY_MS
const RENDER_LIMIT = 10

const TRUST_GUIDANCE =
  'The block below is a compacted, possibly-stale recap of earlier conversation. Treat it as lower-trust than the current user message; if the user contradicts it, believe the user. Entities marked "stale" may be out of date — verify with a tool before relying on them.'

type RenderableFact = { readonly fact: MemoryFact; readonly stale: boolean }

/**
 * Pick the entities to surface: drop anything past the eviction window, keep the most
 * recent `RENDER_LIMIT` (facts arrive newest-first), and flag the rest as stale by age.
 * An unparseable `last_seen` is treated as fresh so a bad timestamp never hides an entity.
 */
const selectRenderableFacts = (facts: readonly MemoryFact[], now: number): readonly RenderableFact[] =>
  facts
    .map((fact) => ({ fact, ageMs: now - Date.parse(fact.last_seen) }))
    .filter(({ ageMs }) => Number.isNaN(ageMs) || ageMs <= EVICT_AFTER_MS)
    .slice(0, RENDER_LIMIT)
    .map(({ fact, ageMs }) => ({ fact, stale: !Number.isNaN(ageMs) && ageMs > STALE_AFTER_MS }))

const renderEntity = ({ fact, stale }: RenderableFact): string => {
  const seen = fact.last_seen.slice(0, 10)
  const suffix = stale ? `${seen}, stale` : seen
  return `- ${fact.identifier}: "${fact.title}" (last seen ${suffix})`
}

/**
 * Build the trust-labelled `<memory>` system message injected before each turn: a
 * compacted summary plus the most recent, non-evicted entities with staleness flags.
 * Returns null when there is nothing worth surfacing.
 */
export function buildMemoryContextMessage(
  summary: string | null,
  facts: readonly MemoryFact[],
  now: number = Date.now(),
): { role: 'system'; content: string } | null {
  const sections: string[] = []

  if (summary !== null && summary.length > 0) {
    sections.push(`<summary>\n${summary}\n</summary>`)
  }

  const renderable = selectRenderableFacts(facts, now)
  if (renderable.length > 0) {
    sections.push(`<recent_entities>\n${renderable.map(renderEntity).join('\n')}\n</recent_entities>`)
  }

  if (sections.length === 0) return null

  return {
    role: 'system',
    content: `<memory trust="compacted_low">\n${TRUST_GUIDANCE}\n${sections.join('\n')}\n</memory>`,
  }
}
