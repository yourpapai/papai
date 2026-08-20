// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Finding, Resolution } from './agent-layer.js'
import type { DepthProfile, FindingCounts } from './events.js'
import { ResolverOutputSchema } from './review-loop.js'

export const ROUND_CAPS: Record<DepthProfile, number> = { S: 1, M: 3, L: 4 }

export interface ConvergenceVerdict {
  readonly verdict: 'converged' | 'open'
  readonly counts: FindingCounts
}

export function evaluateConvergence(resolutions: readonly Resolution[]): ConvergenceVerdict {
  const counts: FindingCounts = { blocker: 0, material: 0, nitpick: 0 }
  for (const resolution of resolutions) {
    if (resolution.class === 'BLOCKER') counts.blocker += 1
    else if (resolution.class === 'MATERIAL') counts.material += 1
    else counts.nitpick += 1
  }
  const verdict = counts.blocker === 0 && counts.material === 0 && counts.nitpick <= 3 ? 'converged' : 'open'
  return { verdict, counts }
}

function dedupeKey(finding: Finding): string {
  return `${finding.gap.trim().toLowerCase()}|${finding.question.trim().toLowerCase()}`
}

export function mergeLensFindings(...lensFindings: readonly (readonly Finding[])[]): Finding[] {
  const seen = new Set<string>()
  const merged: Finding[] = []
  for (const findings of lensFindings) {
    for (const finding of findings) {
      const key = dedupeKey(finding)
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(finding)
      }
    }
  }
  return merged
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

async function readLedgerRound(sidecarDir: string, round: number): Promise<Resolution[]> {
  try {
    const raw = await readFile(path.join(sidecarDir, `resolutions-${round}.json`), 'utf8')
    return ResolverOutputSchema.parse(JSON.parse(raw)).resolutions
  } catch {
    return []
  }
}

export async function readResolutionsLedger(sidecarDir: string, beforeRound: number): Promise<Resolution[]> {
  const rounds = Array.from({ length: beforeRound - 1 }, (_, index) => index + 1)
  const perRound = await Promise.all(rounds.map((round) => readLedgerRound(sidecarDir, round)))
  return perRound.flat()
}

const REVIEW_RUBRIC = [
  'Classify every finding as BLOCKER (cannot proceed safely), MATERIAL (should change before apply),',
  'or NITPICK (cosmetic). Quote the verbatim gap from the artifact for every finding.',
  'Answer-before-ask: attempt to answer every question from the repository first and record the',
  'attempt as code_evidence_attempted. Repo-answerable questions are consistency checks, not questions.',
  'Only genuine product-judgment gaps survive as BLOCKERs.',
].join('\n')

function ledgerLines(ledger: readonly Resolution[]): string[] {
  return ledger.map((entry) => {
    const note = entry.justification ?? entry.outcome ?? 'no note'
    return `- [${entry.id}] ${entry.class} ${entry.resolution} — ${note} (do not re-raise without new evidence)`
  })
}

export function buildReviewerPrompt(input: {
  readonly lens: 'reviewer' | 'skeptic'
  readonly artifacts: string
  readonly conventions: string
  readonly ledger: readonly Resolution[]
  readonly outputTarget: string
}): string {
  const lensBrief =
    input.lens === 'skeptic'
      ? 'You are the skeptic reviewer: focus on ops, migration, security, and what-breaks-if failure modes.'
      : 'You are the implementer-lens reviewer: check the artifacts for correctness and completeness against the conventions.'
  const parts = [
    `${lensBrief} Review only the artifacts below — judge what they state, nothing else.`,
    '',
    '## Conventions',
    input.conventions,
    '',
    '## Rubric',
    REVIEW_RUBRIC,
  ]
  if (input.ledger.length > 0) parts.push('', '## Previously resolved findings', ...ledgerLines(input.ledger))
  parts.push(
    '',
    '## Artifacts',
    input.artifacts,
    '',
    `Write your findings as JSON to ${input.outputTarget}:`,
    '{"findings": [{"id": "F<n>", "class": "BLOCKER"|"MATERIAL"|"NITPICK", "gap": "<verbatim quote>",',
    ' "question": string, "code_evidence_attempted": string}]}',
  )
  return parts.join('\n')
}

export function buildResolverPrompt(input: {
  readonly artifacts: string
  readonly findings: readonly Finding[]
  readonly conventions: string
  readonly taskText: string
  readonly outputTarget: string
}): string {
  return [
    'You are the resolver. A reviewer produced the findings below against these artifacts.',
    'Assign each finding its final class and resolve it by exactly one of:',
    '- edited (fix the artifact), evidence-answered (answer from repo evidence), assumed (log an assumption',
    '  with a least-surprise default applied), or dismissed (requires a one-line justification).',
    'Findings lacking a verbatim gap quote, or whose quoted gap is answered verbatim elsewhere, are',
    'nitpick-eligible dismissals.',
    '',
    '## Task description',
    input.taskText,
    '',
    '## Conventions',
    input.conventions,
    '',
    '## Artifacts',
    input.artifacts,
    '',
    '## Findings',
    JSON.stringify(input.findings, null, 2),
    '',
    `Write resolutions as JSON to ${input.outputTarget}:`,
    '{"resolutions": [{"id", "class", "resolution": "edited"|"evidence-answered"|"assumed"|"dismissed",',
    ' "outcome"?: string, "justification"?: string}],',
    ' "assumptions": [{"id", "text", "basis": "code-evidence"|"convention"|"default",',
    ' "confidence": "high"|"medium"|"low", "blast_radius": string, "status": "open",',
    ' "evidence": {"files": ["<repo-relative paths this assumption references, at least one"]]}}]}',
  ].join('\n')
}
