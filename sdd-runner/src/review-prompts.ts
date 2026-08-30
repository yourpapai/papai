// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Finding } from './agent-layer.js'
import { concernDigest } from './concern-model.js'
import type { LedgerEntry } from './concern-model.js'

const REVIEW_RUBRIC = [
  'Classify every finding as BLOCKER (cannot proceed safely), MATERIAL (should change before apply),',
  'or NITPICK (cosmetic). Quote the verbatim gap from the artifact for every finding.',
  'Answer-before-ask: attempt to answer every question from the repository first and record the',
  'attempt as code_evidence_attempted. Repo-answerable questions are consistency checks, not questions.',
  'Only genuine product-judgment gaps survive as BLOCKERs.',
].join('\n')

export function buildReviewerPrompt(input: {
  readonly lens: 'reviewer' | 'skeptic'
  readonly artifacts: string
  readonly conventions: string
  readonly ledger: readonly LedgerEntry[]
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
  if (input.ledger.length > 0) {
    parts.push(
      '',
      '## Known concerns',
      'Re-raise a known concern only with new evidence; otherwise leave it resolved.',
      ...concernDigest(input.ledger),
    )
  }
  parts.push(
    '',
    '## Artifacts',
    input.artifacts,
    '',
    `Write your findings as JSON to ${input.outputTarget}:`,
    ...(input.lens === 'skeptic'
      ? ['{"findings": [{"id": "S<n>", "class": "BLOCKER"|"MATERIAL"|"NITPICK", "gap": "<verbatim quote>",']
      : ['{"findings": [{"id": "F<n>", "class": "BLOCKER"|"MATERIAL"|"NITPICK", "gap": "<verbatim quote>",']),
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
    'Every "assumed" resolution MUST have a matching assumption whose findingId is that finding\'s id;',
    'an assumed finding with no such assumption is treated as unresolved and goes to a human.',
    'Only claim "edited" when you actually changed an artifact file — an edit that changes nothing',
    'is treated as unresolved.',
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
    ' "assumptions": [{"id": "A<number>", "findingId"?: "F<n>", "text",',
    '   "basis": "code-evidence"|"convention"|"default",',
    ' "confidence": "high"|"medium"|"low", "blast_radius": string, "status": "open",',
    ' "evidence": {"files": ["<repo-relative paths this assumption references, at least one"]]}}]}',
  ].join('\n')
}
