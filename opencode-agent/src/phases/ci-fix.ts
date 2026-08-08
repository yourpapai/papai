// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { formatFailures, runCheckLoop } from '../check-loop.js'
import type { CheckLoopResult } from '../check-loop.js'
import { branchNameFor } from '../git.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { buildCiFixPrompt } from '../prompts.js'
import { mintEnvelope } from './envelope.js'

const CI_FIX_INSTRUCTIONS = [
  'Continuous integration is red on a pull request you opened. Diagnose and fix the root cause.',
  'Reproduce the failure from the check output before changing anything.',
  'Never weaken, skip, or delete a test to make a check pass, and never add lint-disable or type-ignore comments.',
  'If the failure is unrelated to this branch, say so in your summary rather than papering over it.',
].join('\n')

/**
 * Entered when a check run goes red on the agent's own pull request.
 *
 * The loop reproduces CI locally rather than reading its logs: the runner has
 * the branch checked out anyway, and a reproduced failure is worth more to the
 * model than a log excerpt from a different machine. Each round is capped, and
 * `ciAttempts` caps the rounds across the pull request's whole life so a
 * genuinely broken branch cannot bounce between the agent and CI forever.
 */
export const handleCiFix: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, state } = input
  const branch = branchNameFor(state.issueId)
  await deps.git.ensureBranch(branch, await deps.baseBranch())

  const envelope = mintEnvelope()
  const agent = await deps.agent()
  const system = composeSystemPrompt({
    phase: 'CI_FIX',
    skills: await deps.skills('CI_FIX'),
    repoRoot: deps.config.repoRoot,
    nonce: envelope.nonce,
    instructions: CI_FIX_INSTRUCTIONS,
  })

  const outcome = await runCheckLoop({
    checks: deps.config.checks,
    run: deps.runCheck,
    maxRounds: deps.config.ciFixMaxRounds,
    repair: async (failures, round) => {
      deps.log.warn(
        { issue: state.issueId, round, checks: failures.map((failure) => failure.name) },
        'Repairing red checks',
      )
      await agent.prompt({ system, prompt: buildCiFixPrompt(envelope, failures, round), agent: 'build' })
    },
  })

  const pushed = await commitAndPush(input, branch)
  deps.log.info({ issue: state.issueId, branch, passed: outcome.passed, pushed }, 'CI fix round finished')

  return { signal: 'CI_FIXED', comment: renderCiReport(input, outcome, pushed, deps.config.runUrl) }
}

const commitAndPush = async (input: PhaseInput, branch: string): Promise<boolean> => {
  const committed = await input.deps.git.commitAll(
    `fix(agent): repair CI for issue #${input.state.issueId}\n\nRefs #${input.state.issueId}`,
  )
  if (!committed) return false

  await input.deps.git.push(branch)
  return true
}

/** The red run that brought the pipeline here; absent unless CI triggered it. */
const redRunUrl = (input: PhaseInput): string | null => (input.trigger.kind === 'ci' ? input.trigger.runUrl : null)

/**
 * The two runs this comment is about, told apart.
 *
 * There have always been two — the red one being repaired and the agent one
 * doing the repairing — and this comment used to print only the first, under the
 * bare word "run". A maintainer reading it had no way to tell which was meant,
 * and no link at all to the job whose log would say what the repair actually
 * did. Both come in as arguments: the red one is a fact about the event, the
 * agent one a fact about the environment, and neither is a renderer's to fetch.
 */
const runLines = (red: string | null, agent: string | null): readonly string[] => [
  ...(red === null ? [] : [`- Red run I am repairing: ${red}`]),
  ...(agent === null ? [] : [`- This repair ran in: ${agent}`]),
]

const renderCiReport = (
  input: PhaseInput,
  outcome: CheckLoopResult,
  pushed: boolean,
  agentRunUrl: string | null,
): string => {
  const { state, deps } = input
  const lines = [
    `### CI fix attempt ${state.ciAttempts} of ${deps.config.maxCiAttempts}`,
    '',
    ...runLines(redRunUrl(input), agentRunUrl),
    `- Local checks: ${outcome.passed ? '✅ green' : '❌ still red'} after ${outcome.rounds} round(s)`,
    `- Pushed a fix: ${pushed ? 'yes' : 'no — nothing changed'}`,
  ]

  if (!outcome.passed) {
    lines.push(
      '',
      pushed
        ? 'I could not get every check green. The pull request has my partial fix; the remaining failures are below.'
        : 'I could not reproduce or fix the failure locally, so I changed nothing.',
      '',
      '<details><summary>Remaining failures</summary>',
      '',
      formatFailures(outcome.failures),
      '',
      '</details>',
    )
  }

  return lines.join('\n')
}
