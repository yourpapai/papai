// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChangeDigest } from './gate-digest-extract.js'
import type { GateAssumption, GateBlocker, GateDigestInput, GateFinding } from './gate-model.js'
import { formatTrajectoryBlock } from './renderer.js'

export type { GateDigestInput }

const NO_WHY = '_(no "Why" section in proposal.md)_'
const NO_IMPACT = '_(no "Impact" section in proposal.md)_'
const NO_ASSUMPTIONS = '_(no assumptions logged)_'

function costMarker(input: GateDigestInput): string {
  if (input.costKnown) return 'metered'
  return input.costUsd > 0 ? 'estimated' : 'unknown'
}

/**
 * Render the `### Change digest` subsection — a 5-tuple (WHAT/WHY/TOUCHES/
 * RISKS/BLAST) so a human opening the gate MD can grasp the change at a glance.
 * WHAT/WHY/TOUCHES come from `extractChangeDigest`; RISKS/BLAST reference
 * sections already rendered elsewhere in the gate (mode-aware for RISKS, since
 * the early gate shows "Open MATERIAL findings at cap" and the final gate shows
 * "Nitpicks (informational)"). Missing fields render one-line placeholders.
 */
export function renderChangeDigest(digest: ChangeDigest, mode: 'early' | 'final', hasAssumptions: boolean): string[] {
  const what = digest.what ?? NO_WHY
  const why = digest.why ?? NO_WHY
  const touches = digest.touches !== null && digest.touches.length > 0 ? digest.touches.join(', ') : NO_IMPACT
  const risksTarget = mode === 'early' ? 'Open MATERIAL findings at cap' : 'Nitpicks (informational)'
  const blast = hasAssumptions ? 'see "Assumptions (blast-ranked)" below' : NO_ASSUMPTIONS
  return [
    '### Change digest',
    '',
    `- **WHAT**: ${what}`,
    `- **WHY**: ${why}`,
    `- **TOUCHES**: ${touches}`,
    `- **RISKS**: see "${risksTarget}" below`,
    `- **BLAST**: ${blast}`,
  ]
}

export function writeGateDigest(input: GateDigestInput): string {
  const ranked = [...input.assumptions].sort((a, b) => b.blast_radius.localeCompare(a.blast_radius))
  const lines: string[] = [
    `<!-- gate-${input.version}.md -->`,
    '',
    input.mode === 'early'
      ? `## Early gate (cap hit) — change ${input.changeName}`
      : `## Final gate — change ${input.changeName}`,
    '',
    'Check every assumption box to approve. Leave a box unchecked to veto (optional `→ <redirect>` beneath).',
    'Answer a cap-hit blocker with `→ <answer>` beneath it, or `→ OVERRIDE` to override.',
    'Write `ABORT` on its own line to abort.',
    '',
    ...renderDecisions(input.mode),
    '',
    '### Summary',
    input.summary,
    '',
    ...renderChangeDigest(input.changeDigest, input.mode, input.assumptions.length > 0),
    '',
    `### Cost / duration · $${input.costUsd.toFixed(2)} · ${Math.round(input.durationMs / 1000)}s · ${costMarker(input)}`,
  ]
  appendGateSections(lines, input, ranked)
  return lines.join('\n')
}

/**
 * Render the `### Decisions` block: every decision line names its downstream
 * effect, so no approval is consequence-blind. At an early (cap-hit) gate
 * approval continues the pipeline into decomposition, atomicity checking, and
 * a final gate; at the final gate approval completes the run.
 */
export function renderDecisions(mode: 'early' | 'final'): string[] {
  const approve =
    mode === 'early'
      ? '- **approve** — continues to task decomposition, atomicity checking, and a final gate (BREAKING: no longer stops the run here)'
      : '- **approve** — completes the run with the full artifact set (proposal, specs, design, tasks)'
  return [
    '### Decisions',
    '',
    approve,
    '- **veto** (leave a box unchecked) — runs one resolver pass on the redirects, then re-gates',
    '- **abort** (`ABORT` on its own line) — ends the run without completing; the only early exit that spends nothing further',
  ]
}

function appendGateSections(lines: string[], input: GateDigestInput, ranked: readonly GateAssumption[]): void {
  appendBlockers(lines, input.blockers)
  if (input.mode === 'early') appendEarlyCapHitSections(lines, input)
  appendNitpicks(lines, input.openNitpicks)
  appendAssumptions(lines, ranked, input.runId)
}

function appendBlockers(lines: string[], blockers: readonly GateBlocker[]): void {
  if (blockers.length === 0) return
  lines.push('', '### Cap-hit blockers (answer or override)')
  for (const blocker of blockers) {
    lines.push('', `${blocker.id} ${blocker.gap}`, `evidence: ${blocker.evidence}`, '→ <answer or OVERRIDE>')
  }
}

function appendEarlyCapHitSections(lines: string[], input: GateDigestInput): void {
  if (input.openMaterial.length > 0) appendOpenMaterial(lines, input)
  if (input.blockers.length === 0 && input.capHitFired) {
    lines.push('', '### Trajectory reviewed', '', '- [ ] T1 I reviewed the trajectory and the open findings above')
  }
  if (input.capHitFired) appendExtendDirective(lines)
}

function appendOpenMaterial(lines: string[], input: GateDigestInput): void {
  const trajectoryBlock = formatTrajectoryBlock(input.trajectory)
  if (trajectoryBlock !== '') lines.push('', trajectoryBlock)
  lines.push('', '### Open MATERIAL findings at cap (reviewed)')
  for (const finding of input.openMaterial) {
    lines.push('', `- [ ] ${finding.id} ${finding.gap}`, `  resolver: ${finding.evidence}`)
  }
}

function appendExtendDirective(lines: string[]): void {
  lines.push(
    '',
    '### Extend',
    '',
    '`→ RUN 1 MORE` — runs one more review round, then re-gates (early-gate only; the depth profile stays fixed, only the cap bumps by 1)',
  )
}

function appendNitpicks(lines: string[], nitpicks: readonly GateFinding[]): void {
  if (nitpicks.length === 0) return
  lines.push('', '### Nitpicks (informational)')
  for (const nitpick of nitpicks) {
    lines.push('', `- ${nitpick.id} ${nitpick.gap}`, `  resolver: ${nitpick.evidence}`)
  }
}

function appendAssumptions(lines: string[], ranked: readonly GateAssumption[], runId: string): void {
  lines.push('', '### Assumptions (blast-ranked)')
  for (const assumption of ranked) {
    lines.push('', `- [ ] ${assumption.id} ${assumption.text}`, `  blast radius: ${assumption.blast_radius}`)
  }
  lines.push('', '### Resume', `gate resume ${runId}`)
}
