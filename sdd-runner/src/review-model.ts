// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Finding, Resolution } from './agent-layer.js'
import { FindingsSidecarSchema } from './agent-layer.js'
import { fingerprintOf } from './concern-model.js'
import type { LedgerEntry } from './concern-model.js'
import type { DepthProfile, FindingCounts } from './events.js'
import { ResolverOutputSchema } from './review-loop.js'

export const ROUND_CAPS: Record<DepthProfile, number> = { S: 1, M: 3, L: 4 }

/** Per-file content digests of the change folder, as `recordArtifactHashes` produces them. */
export type ArtifactDigests = Record<string, string>

/** The round's assumption records, narrowed to what the openness predicate reads. */
export interface AssumptionLink {
  readonly id: string
  readonly findingId?: string
}

/** Round-over-round change-folder snapshots; `previous` is null on the first round. */
export interface RoundDigests {
  readonly previous: ArtifactDigests | null
  readonly current: ArtifactDigests
}

function digestsMoved(digests: RoundDigests): boolean {
  const previous = digests.previous
  if (previous === null) return true
  const keys = new Set([...Object.keys(previous), ...Object.keys(digests.current)])
  for (const key of keys) {
    if (previous[key] !== digests.current[key]) return true
  }
  return false
}

/**
 * Whether a resolution still needs a human. Openness is about who is owed
 * something, not about severity:
 *
 * - `dismissed` — the resolver declined; nothing but a human can contest it.
 * - `assumed` — closed only when an assumption record carries this finding's id.
 *   A sidecar whose assumptions carry no `findingId` at all predates the link,
 *   so it falls back to the round-level check (at least one assumption logged)
 *   and pre-change runs resume without a migration.
 * - `edited` — closed only when the change folder actually moved. An edit that
 *   changed no bytes is the one claim that would otherwise let a resolver retire
 *   a finding without doing anything, so it is checked rather than trusted. A
 *   first round has no prior snapshot to compare against and is taken at face
 *   value.
 * - `evidence-answered` — closed; answered from the repository.
 */
export function isOpenResolution(
  resolution: Resolution,
  assumptions: readonly AssumptionLink[],
  digests: RoundDigests,
): boolean {
  if (resolution.resolution === 'dismissed') return true
  if (resolution.resolution === 'evidence-answered') return false
  if (resolution.resolution === 'edited') return !digestsMoved(digests)
  const linkable = assumptions.some((assumption) => assumption.findingId !== undefined)
  if (!linkable) return assumptions.length === 0
  return !assumptions.some((assumption) => assumption.findingId === resolution.id)
}

/** The round's assumptions and change-folder snapshots the openness predicate reads. */
export interface ConvergenceContext {
  readonly assumptions: readonly AssumptionLink[]
  readonly digests: RoundDigests
}

interface ConvergenceCounts {
  /** Every finding the round recorded, by class — the trajectory's number. */
  readonly raised: FindingCounts
  /** Only what a human must still settle — the gate's number. */
  readonly open: FindingCounts
  /** Legacy alias of `raised`, kept so pre-split consumers read the same value. */
  readonly counts: FindingCounts
}

export interface ConvergenceVerdict extends ConvergenceCounts {
  readonly verdict: 'converged' | 'needs-review' | 'open'
}

/** Without a context there is nothing to judge openness by, so `needs-review` is unreachable. */
export interface RaisedOnlyVerdict extends ConvergenceCounts {
  readonly verdict: 'converged' | 'open'
}

function countByClass(resolutions: readonly Resolution[]): FindingCounts {
  const counts: FindingCounts = { blocker: 0, material: 0, nitpick: 0 }
  const seen = new Set<string>()
  for (const resolution of resolutions) {
    if (seen.has(resolution.id)) continue
    seen.add(resolution.id)
    if (resolution.class === 'BLOCKER') counts.blocker += 1
    else if (resolution.class === 'MATERIAL') counts.material += 1
    else counts.nitpick += 1
  }
  return counts
}

function clearsBar(counts: FindingCounts): boolean {
  return counts.blocker === 0 && counts.material === 0 && counts.nitpick <= 3
}

/**
 * A round's verdict over two distinct count sets. `raised` is every finding the
 * round recorded — the number the convergence trajectory, the burndown and lens
 * escalation want, because a falling raise-rate is what "the loop is converging"
 * means. `open` counts only what a human must settle, which is what the gate and
 * the decision ladder want.
 *
 * `needs-review` is the state the single-number model could not express: nothing
 * is open, but the round edited an artifact above a nitpick and no reviewer has
 * seen that edit yet. Called without a context the function keeps the pre-split
 * reading exactly — `open` equals `raised` — so a caller that cannot supply the
 * round's assumptions and digests is never silently given a laxer verdict.
 */
export function evaluateConvergence(resolutions: readonly Resolution[]): RaisedOnlyVerdict
export function evaluateConvergence(resolutions: readonly Resolution[], context: ConvergenceContext): ConvergenceVerdict
export function evaluateConvergence(
  resolutions: readonly Resolution[],
  context?: ConvergenceContext,
): ConvergenceVerdict {
  const raised = countByClass(resolutions)
  if (context === undefined) {
    return { verdict: clearsBar(raised) ? 'converged' : 'open', counts: raised, raised, open: raised }
  }
  const isOpen = (entry: Resolution): boolean => isOpenResolution(entry, context.assumptions, context.digests)
  const open = countByClass(resolutions.filter(isOpen))
  if (!clearsBar(open)) return { verdict: 'open', counts: raised, raised, open }
  const unreviewedEdit = resolutions.some(
    (entry) => entry.resolution === 'edited' && entry.class !== 'NITPICK' && !isOpen(entry),
  )
  return { verdict: unreviewedEdit ? 'needs-review' : 'converged', counts: raised, raised, open }
}

const SEVERITY_RANK: Record<Finding['class'], number> = { BLOCKER: 3, MATERIAL: 2, NITPICK: 1 }

export function mergeLensFindings(...lensFindings: readonly (readonly Finding[])[]): Finding[] {
  const seen = new Map<string, Finding>()
  for (const findings of lensFindings) {
    for (const finding of findings) {
      const key = fingerprintOf(finding.gap)
      const existing = seen.get(key)
      if (existing === undefined) {
        seen.set(key, finding)
      } else if (SEVERITY_RANK[finding.class] > SEVERITY_RANK[existing.class]) {
        seen.set(key, { ...existing, class: finding.class })
      }
    }
  }
  return [...seen.values()]
}

export function lensesForRound(
  depth: DepthProfile,
  round: number,
  openBlockers: number,
): readonly ('reviewer' | 'skeptic')[] {
  if (depth === 'L') return ['reviewer', 'skeptic']
  if (depth === 'M' && round >= 3 && openBlockers > 0) return ['reviewer', 'skeptic']
  return ['reviewer']
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

const REVIEW_ARTIFACT_NAMES = new Set(['proposal.md', 'design.md'])

export async function readReviewArtifacts(changeDir: string): Promise<string> {
  const files = (await listMarkdownFiles(changeDir)).filter((file) => {
    const base = path.basename(file)
    return REVIEW_ARTIFACT_NAMES.has(base) || file.includes(`${path.sep}specs${path.sep}`)
  })
  const parts = await Promise.all(
    files.map(async (file) => `### File: ${path.relative(changeDir, file)}\n${await readFile(file, 'utf8')}`),
  )
  return parts.join('\n\n')
}

/** Per-file artifact contents for the deterministic consistency scan (loop-memory D6). */
export async function readReviewArtifactFiles(
  changeDir: string,
): Promise<readonly { path: string; content: string }[]> {
  const files = (await listMarkdownFiles(changeDir)).filter((file) => {
    const base = path.basename(file)
    return REVIEW_ARTIFACT_NAMES.has(base) || file.includes(`${path.sep}specs${path.sep}`)
  })
  return Promise.all(
    files.map(async (file) => ({ path: path.relative(changeDir, file), content: await readFile(file, 'utf8') })),
  )
}

/** Per-round resolutions with their finding gap text joined from the round's findings sidecars. */
export async function readResolutionsLedger(sidecarDir: string, beforeRound: number): Promise<LedgerEntry[]> {
  const rounds = Array.from({ length: beforeRound - 1 }, (_, index) => index + 1)
  const perRound = await Promise.all(rounds.map((round) => readLedgerRound(sidecarDir, round)))
  return perRound.flat()
}

async function readLedgerRound(sidecarDir: string, round: number): Promise<LedgerEntry[]> {
  try {
    const raw = await readFile(path.join(sidecarDir, `resolutions-${round}.json`), 'utf8')
    const resolutions = ResolverOutputSchema.parse(JSON.parse(raw)).resolutions
    const gaps = await gapTextsForRound(sidecarDir, round)
    return resolutions.map((resolution) => ({ round, gap: gaps.get(resolution.id) ?? '', resolution }))
  } catch {
    return []
  }
}

async function gapTextsForRound(sidecarDir: string, round: number): Promise<Map<string, string>> {
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
    for (const finding of findings) gaps.set(finding.id, finding.gap)
  }
  return gaps
}
