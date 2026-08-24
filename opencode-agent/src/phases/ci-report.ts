// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { formatFailures } from '../check-loop.js'
import type { CheckLoopResult } from '../check-loop.js'
import type { Diagnosis } from '../ci-diagnosis.js'
import type { PhaseInput } from '../phase-context.js'
import type { FailedJob } from '../red-run.js'
import type { TriggerEvent } from '../trigger-events.js'

/**
 * The CI-fix round's report — the wording half of the phase, split from
 * `ci-fix.ts` along the seam the repo's own doctrine names: a renderer changes
 * when the wording does, the handler when the flow does. A round now ends in
 * more ways than a check loop can express, and every one of them earns its own
 * sentence, because the incident this phase carries (runs 32641725211 /
 * 32652877782) was two rounds of "nothing changed" over a failure the round
 * never looked at.
 */

/** What the round's commit came to. */
export interface RoundCommit {
  pushed: boolean
  dropped: readonly string[]
}

/** Which of the repair paths the round took, and what it proved. */
export interface RoundProof {
  /** The verdict the diagnosis turn returned; `null` when the round never got as far as asking. */
  diagnosis: Diagnosis | null
  /** The failures the round was handed: CI's own facts about the red run. */
  failures: readonly FailedJob[]
  /** The bounded loop's result, when the round ran one. */
  loop: CheckLoopResult | null
  /** Whether the repair, if any, rested on log analysis rather than an observed local pass. */
  logBased: boolean
  /** Why the red run could not be read at all, when it could not; `null` when it could. */
  readError: string | null
}

/** The red run that brought the pipeline here; absent unless CI triggered it. */
const redRunUrl = (input: PhaseInput): string | null => (input.trigger.kind === 'ci' ? input.trigger.runUrl : null)

const runLines = (red: string | null, agent: string | null): readonly string[] => [
  ...(red === null ? [] : [`- Red run I am repairing: ${red}`]),
  ...(agent === null ? [] : [`- This repair ran in: ${agent}`]),
]

/**
 * CI's own account of what failed — the facts every path starts from.
 *
 * The unknown and the none lines are keyed on the door, like `redRunUrl`
 * above: a command-bought round read the head's check runs, and asserting
 * "the run is red" or "the run could not be read" about checks it read fine
 * (or tried and failed to read) states facts only the red-run door knows.
 */
const failureLines = (proof: RoundProof, kind: TriggerEvent['kind']): readonly string[] => {
  if (proof.readError !== null) {
    return [
      kind === 'ci'
        ? `- CI failures: unknown — the red run could not be read (${proof.readError})`
        : `- CI failures: unknown — the head’s check runs could not be read (${proof.readError})`,
    ]
  }
  if (proof.failures.length === 0) {
    return [
      kind === 'ci'
        ? '- CI failures: none — the run is red but no failed job could be found'
        : '- CI failures: none — no failed check run could be found on the head',
    ]
  }
  return proof.failures.map((job) => {
    const steps = job.failedSteps.length === 0 ? 'no step failed' : job.failedSteps.join(', ')
    return `- CI failure: **${job.name}** (failed steps: ${steps})`
  })
}

/**
 * What the round proved, which is less than it used to claim.
 *
 * A green verdict on a round that pushed nothing is a fact about **this job**
 * and not about the code anyone will merge; a log-based fix is a fact about the
 * log; a needs-human verdict is not a verdict about the code at all. Saying
 * which of these a line describes is the honesty rule the incident bought.
 * The two degraded lines carry the same door-keying as `failureLines`.
 */
const verdictLine = (proof: RoundProof, commit: RoundCommit, kind: TriggerEvent['kind']): string => {
  const { diagnosis, loop, logBased, readError } = proof
  if (readError !== null) {
    return kind === 'ci'
      ? '- Verdict: this failure needs you — the red run could not be read'
      : '- Verdict: this failure needs you — the head’s check runs could not be read'
  }
  if (diagnosis?.verdict === 'needs-human') return '- Verdict: this failure needs you, not another repair round'
  if (loop !== null && !logBased) {
    const rounds = `after ${loop.rounds} round(s)`
    if (!loop.passed) return `- Local reproduction: ❌ still red ${rounds}`
    return commit.pushed
      ? `- Local reproduction: ✅ the derived command passed ${rounds}`
      : `- Local reproduction: ✅ passed ${rounds} in this job — but nothing was pushed, so the branch is unchanged`
  }
  if (logBased) return '- Proof: the CI log, not a local run — this failure could not be reproduced on this runner'
  return kind === 'ci'
    ? '- Diagnosis: the run could not be read; nothing was attempted'
    : '- Diagnosis: no failed check run could be found on the head; nothing was attempted'
}

/** Whether the round pushed, and — when it did not — which of the reasons. */
const pushedLine = (proof: RoundProof, commit: RoundCommit): string => {
  if (proof.readError !== null || proof.diagnosis?.verdict === 'needs-human')
    return '- Pushed a fix: no — this one is yours'
  if (commit.pushed) {
    return proof.logBased ? '- Pushed a fix: yes — verified against the CI log' : '- Pushed a fix: yes'
  }
  return commit.dropped.length === 0
    ? '- Pushed a fix: no — nothing changed'
    : '- Pushed a fix: no — the fix exists, but this pipeline cannot push it'
}

/**
 * The paragraph a blocked round earns, and the reason this phase reports at all.
 *
 * Three things it has to say, because leaving any one of them out is what let
 * the same round run three times: which file, that the work was really done, and
 * that applying it is a maintainer's job rather than something `/retry` reaches.
 */
const blockedNote = (dropped: readonly string[]): readonly string[] => {
  if (dropped.length === 0) return []
  return [
    '',
    `I wrote a fix, but it touches ${dropped.map((path) => `\`${path}\``).join(', ')} — which this pipeline's ` +
      'token cannot push, so it was left out of the commit rather than discarding everything else with it.',
    '',
    'Apply it by hand, or grant the GitHub App the `workflows` permission. Replying `/retry` will not help: ' +
      'another round reaches the same edit and drops it again.',
  ]
}

/** The needs-human paragraph: what failed, why the agent cannot fix it, the remedy. */
const humanNote = (proof: RoundProof): readonly string[] => {
  const diagnosis = proof.diagnosis
  if (diagnosis?.verdict !== 'needs-human') return []
  const excerpts = proof.failures.map((job) => `**${job.name}**\n\n${job.log}`).join('\n\n')
  return [
    '',
    'A human is needed:',
    '',
    diagnosis.humanReport ?? '',
    '',
    '<details><summary>What CI said</summary>',
    '',
    excerpts,
    '',
    '</details>',
  ]
}

/**
 * What a round that left checks red says about why.
 *
 * "I changed nothing" is only true of a round that wrote nothing. A round whose
 * fix was dropped changed plenty and delivered none of it, and a needs-human
 * round wrote nothing on purpose — its sentence is the note above, not an
 * apology for idleness.
 */
const stillRedNote = (proof: RoundProof, commit: RoundCommit): string => {
  if (proof.diagnosis?.verdict === 'needs-human') return ''
  if (commit.pushed)
    return 'I could not get the derived command green. The pull request has my partial fix; the remaining failures are below.'
  return commit.dropped.length > 0
    ? 'The checks below are still red, and the fix I wrote is not on the branch for the reason above.'
    : 'I could not get the derived command green, so nothing was pushed.'
}

export const renderCiReport = (
  input: PhaseInput,
  proof: RoundProof,
  commit: RoundCommit,
  agentRunUrl: string | null,
): string => {
  const { state, deps } = input
  const lines = [
    `### CI fix attempt ${state.ciAttempts} of ${deps.config.maxCiAttempts}`,
    '',
    ...runLines(redRunUrl(input), agentRunUrl),
    ...failureLines(proof, input.trigger.kind),
    verdictLine(proof, commit, input.trigger.kind),
    pushedLine(proof, commit),
    ...humanNote(proof),
    ...blockedNote(commit.dropped),
  ]

  if (proof.loop !== null && !proof.loop.passed) {
    lines.push(
      '',
      stillRedNote(proof, commit),
      '',
      '<details><summary>Remaining failures</summary>',
      '',
      formatFailures(proof.loop.failures),
      '',
      '</details>',
    )
  }

  return lines.join('\n')
}
