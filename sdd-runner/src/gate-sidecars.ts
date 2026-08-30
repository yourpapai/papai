// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { FindingsSidecarSchema } from './agent-layer.js'
import type { Finding, Resolution } from './agent-layer.js'
import type { ConcernRecord } from './concern-model.js'
import type { FindingCounts } from './events.js'
import { readRoundDigests } from './materialize.js'
import { ResolverOutputSchema } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { evaluateConvergence, isOpenResolution } from './review-model.js'

const GAP_EXCERPT_MAX = 96

/**
 * A gap as a gate row can safely carry it: one line, no leading redirect marker,
 * bounded length. The checkbox grammar anchors on `- [x] F3` at line start and a
 * redirect is a line opening with an arrow, so an unsanitized multi-line gap
 * could otherwise be parsed back as a decision it never was. Reduces to the
 * empty string when nothing survives, and the caller then renders the id.
 */
function gapExcerpt(text: string): string {
  const flat = text
    .replace(/\s+/gu, ' ')
    .replace(/^[\s→]+/u, '')
    .trim()
  return flat.length <= GAP_EXCERPT_MAX ? flat : `${flat.slice(0, GAP_EXCERPT_MAX - 1)}…`
}

/**
 * Gap text per finding id for a round (loop-memory D7): reads the round's
 * findings sidecars (both lenses) so gate rows can render the finding's gap
 * excerpt. Sound under the round's unique resolution ids; a missing sidecar
 * entry falls back to rendering the id.
 */
export async function findingsGapTextsFor(sidecarDir: string, round: number): Promise<Map<string, string>> {
  const names = [`findings-${round}.json`, `findings-skeptic-${round}.json`]
  const perFile = await Promise.all(
    names.map(async (name): Promise<readonly Finding[]> => {
      try {
        const raw = await readFile(path.join(sidecarDir, name), 'utf8')
        return FindingsSidecarSchema.parse(JSON.parse(raw)).findings
      } catch {
        return []
      }
    }),
  )
  const gaps = new Map<string, string>()
  for (const findings of perFile) {
    for (const finding of findings) {
      const excerpt = gapExcerpt(finding.gap)
      if (excerpt !== '') gaps.set(finding.id, excerpt)
    }
  }
  return gaps
}

function isConcernRecord(value: unknown): value is ConcernRecord {
  if (typeof value !== 'object' || value === null) return false
  return (
    'fingerprint' in value &&
    typeof value.fingerprint === 'string' &&
    'firstRound' in value &&
    typeof value.firstRound === 'number' &&
    'lastRound' in value &&
    typeof value.lastRound === 'number' &&
    'entries' in value &&
    Array.isArray(value.entries)
  )
}

/** Read the round-close concern sidecar (loop-memory D5); missing or corrupt → empty. */
export async function readConcernSidecar(sidecarDir: string): Promise<readonly ConcernRecord[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(path.join(sidecarDir, 'concerns.json'), 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw.filter(isConcernRecord)
  } catch {
    return []
  }
}

const EMPTY_COUNTS: FindingCounts = { blocker: 0, material: 0, nitpick: 0 }

/**
 * Rebuild a round's review result from its sidecars, applying the same openness
 * predicate the live loop used. A resumed run's gate must see the set the run
 * would have seen; recomputing it by class alone would show a resumed operator
 * findings the live one had already settled.
 *
 * An unreadable sidecar keeps the pre-change reading — empty buckets, treated as
 * converged — rather than becoming a new gating condition here. The ladder's
 * integrity cross-check is what fails closed on an unparseable sidecar;
 * duplicating that in the reader would change resume routing.
 */
export async function readReviewResultFromSidecars(
  sidecarDir: string,
  round: number,
  outcome: 'converged' | 'cap-hit',
): Promise<ReviewLoopResult> {
  const empty = { outcome, rounds: round, verdict: 'converged', raised: EMPTY_COUNTS } as const
  try {
    const raw = await readFile(path.join(sidecarDir, `resolutions-${round}.json`), 'utf8')
    const parsed = ResolverOutputSchema.parse(JSON.parse(raw))
    const [current, previous] = await Promise.all([
      readRoundDigests(sidecarDir, round),
      readRoundDigests(sidecarDir, round - 1),
    ])
    const context = { assumptions: parsed.assumptions, digests: { previous, current: current ?? {} } }
    const { verdict, raised } = evaluateConvergence(parsed.resolutions, context)
    const openOf = (cls: Resolution['class']): Resolution[] =>
      parsed.resolutions.filter((r) => r.class === cls && isOpenResolution(r, context.assumptions, context.digests))
    return {
      outcome,
      rounds: round,
      verdict,
      raised,
      openBlockers: openOf('BLOCKER'),
      openMaterial: openOf('MATERIAL'),
      openNitpicks: openOf('NITPICK'),
    }
  } catch {
    return { ...empty, openBlockers: [], openMaterial: [], openNitpicks: [] }
  }
}
