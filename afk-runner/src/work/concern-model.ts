// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Finding, Resolution } from '../agent-layer.js'

const STOPWORDS = new Set(
  'the a an of to in and or is are be for with on that this it its as at by from not no if when then shall must will can cannot into than their there these those was were has have had do does did which what where how all any each other more most only over under after before during within without about between'.split(
    ' ',
  ),
)

/**
 * Normalized gap fingerprint (loop-memory D1): case-folded, punctuation-stripped,
 * stopword-pruned token set, canonicalized as sorted joined tokens. The same
 * normalization measured re-raised corpus concerns at identical fingerprints
 * while distinct findings never collided (run-analysis confirmed on afk's own
 * runs — master's compiled constants, not re-derived).
 */
export function fingerprintOf(gap: string): string {
  const tokens = gap
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, ' ')
    .split(/\s+/u)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
  return [...new Set(tokens)].sort().join(' ')
}

export interface LedgerEntry {
  readonly round: number
  readonly gap: string
  readonly resolution: Resolution
}

/** Group ledger entries by concern fingerprint; empty-gap entries group alone (round:id key). */
function groupConcernEntries(ledger: readonly LedgerEntry[]): Map<string, LedgerEntry[]> {
  const groups = new Map<string, LedgerEntry[]>()
  for (const entry of ledger) {
    const trimmed = entry.gap.trim()
    const key = trimmed === '' ? `@${entry.round}:${entry.resolution.id}` : fingerprintOf(trimmed)
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [entry])
    else bucket.push(entry)
  }
  return groups
}

/** Prompt surface budget: at most this many concerns; older ones collapse into the overflow note. */
export const LEDGER_DIGEST_MAX = 15

/**
 * Known-concerns digest (loop-memory D4): one round-tagged line per concern
 * (grouped by gap fingerprint), most recent first, capped with an overflow
 * note — replaces the flat round-untagged ledger the corpus showed growing to
 * 97 lines.
 */
export function concernDigest(ledger: readonly LedgerEntry[]): string[] {
  const concerns = [...groupConcernEntries(ledger).values()]
    .map((entries) => {
      const ordered = [...entries].sort((a, b) => a.round - b.round)
      const last = ordered[ordered.length - 1]!
      const first = ordered[0]!
      const note = last.resolution.justification ?? last.resolution.outcome ?? 'no note'
      return {
        lastRound: last.round,
        line: `r${last.round} [${last.resolution.id}] ${last.resolution.class} ${last.resolution.resolution} — ${note} (seen r${first.round}..r${last.round})`,
      }
    })
    .sort((a, b) => b.lastRound - a.lastRound)
  if (concerns.length <= LEDGER_DIGEST_MAX) return concerns.map((concern) => concern.line)
  const overflow = concerns.length - LEDGER_DIGEST_MAX
  return [
    ...concerns.slice(0, LEDGER_DIGEST_MAX).map((concern) => concern.line),
    `… and ${overflow} older concerns (see sidecars/resolutions-*.json)`,
  ]
}

export interface ConcernRecordEntry {
  readonly round: number
  readonly id: string
  readonly class: string
  readonly resolution: string
  readonly outcome?: string
}

export interface ConcernRecord {
  readonly fingerprint: string
  readonly firstRound: number
  readonly lastRound: number
  readonly entries: readonly ConcernRecordEntry[]
}

/** Cross-round concern history (loop-memory D5): the persisted `sidecars/concerns.json` shape. */
export function concernRecords(ledger: readonly LedgerEntry[]): ConcernRecord[] {
  return [...groupConcernEntries(ledger).entries()]
    .map(([fingerprint, entries]) => ({
      fingerprint,
      firstRound: Math.min(...entries.map((entry) => entry.round)),
      lastRound: Math.max(...entries.map((entry) => entry.round)),
      entries: [...entries]
        .sort((a, b) => a.round - b.round)
        .map((entry) => ({
          round: entry.round,
          id: entry.resolution.id,
          class: entry.resolution.class,
          resolution: entry.resolution.resolution,
          ...(entry.resolution.outcome === undefined && entry.resolution.justification === undefined
            ? {}
            : { outcome: entry.resolution.outcome ?? entry.resolution.justification }),
        })),
    }))
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
}

/**
 * Thrash detection (loop-memory D5): a raised finding whose concern has ≥2
 * prior resolved/dismissed entries (third strike), or ≥1 prior entry resolved
 * at a different class (oscillation), gates with history instead of silently
 * running another round.
 */
export function detectConcernThrash(
  records: readonly ConcernRecord[],
  raised: readonly Finding[],
  currentRound: number,
): ConcernRecord[] {
  const thrash = new Map<string, ConcernRecord>()
  for (const finding of raised) {
    const fingerprint = fingerprintOf(finding.gap)
    const record = records.find((entry) => entry.fingerprint === fingerprint)
    if (record === undefined) continue
    const prior = record.entries.filter((entry) => entry.round < currentRound)
    const oscillated = prior.some((entry) => entry.class !== finding.class)
    if (prior.length >= 2 || (prior.length >= 1 && oscillated)) thrash.set(fingerprint, record)
  }
  return [...thrash.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
}
