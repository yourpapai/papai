// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { FindingsSidecarSchema } from './agent-layer.js'
import type { Finding } from './agent-layer.js'
import type { ConcernRecord } from './concern-model.js'
import { ResolverOutputSchema } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'

const GAP_EXCERPT_MAX = 96

function gapExcerpt(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
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
    for (const finding of findings) gaps.set(finding.id, gapExcerpt(finding.gap))
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

/** Rebuild a review result from a round's resolutions sidecar; missing or invalid → empty buckets. */
export async function readReviewResultFromSidecars(
  sidecarDir: string,
  round: number,
  outcome: 'converged' | 'cap-hit',
): Promise<ReviewLoopResult> {
  try {
    const raw = await readFile(path.join(sidecarDir, `resolutions-${round}.json`), 'utf8')
    const parsed = ResolverOutputSchema.parse(JSON.parse(raw))
    return {
      outcome,
      rounds: round,
      openBlockers: parsed.resolutions.filter((r) => r.class === 'BLOCKER'),
      openMaterial: parsed.resolutions.filter((r) => r.class === 'MATERIAL'),
      openNitpicks: parsed.resolutions.filter((r) => r.class === 'NITPICK'),
    }
  } catch {
    return { outcome, rounds: round, openBlockers: [], openMaterial: [], openNitpicks: [] }
  }
}
