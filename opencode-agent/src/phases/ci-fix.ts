// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { formatFailures, runCheckLoop } from '../check-loop.js'
import type { CheckLoopResult } from '../check-loop.js'
import { buildCommitRepairPrompt, commitWithRepair } from '../commit-repair.js'
import { droppedBy } from '../git-commit.js'
import { branchNameFor } from '../git.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { OpenCodeAgent } from '../opencode-adapter.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { buildCiFixPrompt } from '../prompts.js'
import type { UntrustedEnvelope } from '../prompts.js'
import { PROTECTED_PATHS_RULE } from '../protected-paths.js'
import { mintEnvelope } from './envelope.js'

/**
 * Exported for `instructions.test.ts`, which asserts every phase that can write
 * a file offers the protected-paths rule. This phase is the one that had no
 * copy of it, and is the likeliest to need it: a red job's root cause is often
 * the workflow that ran it.
 */
export const CI_FIX_INSTRUCTIONS = [
  'Continuous integration is red on a pull request you opened. Diagnose and fix the root cause.',
  'Reproduce the failure from the check output before changing anything.',
  'Never weaken, skip, or delete a test to make a check pass, and never add lint-disable or type-ignore comments.',
  'If the failure is unrelated to this branch, say so in your summary rather than papering over it.',
  PROTECTED_PATHS_RULE,
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
      await agent.prompt({
        system,
        prompt: buildCiFixPrompt(envelope, failures, round, state.ciBlockedPaths),
        agent: 'build',
      })
    },
  })

  const commit = await commitAndPush(input, branch, { agent, envelope, system })
  deps.log.info(
    { issue: state.issueId, branch, passed: outcome.passed, pushed: commit.pushed, dropped: commit.dropped },
    'CI fix round finished',
  )

  return {
    signal: 'CI_FIXED',
    comment: renderCiReport(input, outcome, commit, deps.config.runUrl),
    // Rewritten every round, never accumulated: this says what *this* round
    // could not push, so a round that pushed clears a path a maintainer has
    // since applied by hand.
    patch: { ciBlockedPaths: [...commit.dropped] },
  }
}

/** The session and the two things every prompt in this phase is composed against. */
interface Turn {
  agent: OpenCodeAgent
  envelope: UntrustedEnvelope
  system: string
}

/**
 * Commits the repair, and lets the repository refuse it once or twice first.
 *
 * The checks this phase reproduces are the ones **CI** ran; the ones a commit has
 * to satisfy are the repository's own, over the staged files, and they are not the
 * same set — so a round that got every configured check green can still be turned
 * away at the commit, which used to lose the fix and the whole phase with it. Same
 * treatment as the implementation's commit, and the same session: this one has the
 * repair in its context already.
 */
const commitAndPush = async (input: PhaseInput, branch: string, turn: Turn): Promise<RoundCommit> => {
  const { deps, state } = input
  const committed = await commitWithRepair({
    commit: () => deps.git.commitAll(`fix(agent): repair CI for issue #${state.issueId}\n\nRefs #${state.issueId}`),
    repair: async (rejection, round) => {
      await turn.agent.prompt({
        system: turn.system,
        prompt: buildCommitRepairPrompt(turn.envelope, rejection, round),
        agent: 'build',
      })
    },
    maxRounds: deps.config.commitRepairMaxRounds,
    log: deps.log,
    issue: state.issueId,
  })
  if (committed.kind !== 'committed') return { pushed: false, dropped: droppedBy(committed) }

  await deps.git.push(branch)
  return { pushed: true, dropped: committed.dropped }
}

/**
 * What the round's commit came to, as the report needs it.
 *
 * A boolean was enough while "nothing was pushed" had one meaning. It has two:
 * the round changed nothing, and the round wrote only files the remote refuses.
 * The second is what run 31779566286 reported as the first, three times.
 */
interface RoundCommit {
  pushed: boolean
  dropped: readonly string[]
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

/**
 * What the round's checks proved, which is less than it used to claim.
 *
 * A round that pushed nothing leaves the branch exactly as CI found it, so a
 * green verdict is a fact about **this job** and not about the code anyone will
 * merge — and the gap between those two is not pedantic. The repair turn holds
 * `bash`: run 31779566286 got its green by running `bun run build:client` and
 * `docker pull` on its own runner, then re-running the tests. Nothing in the
 * loop can see that, so the honest move is to say which of the two the verdict
 * describes rather than to imply the stronger one.
 */
const verdictLine = (outcome: CheckLoopResult, pushed: boolean): string => {
  const rounds = `after ${outcome.rounds} round(s)`
  if (!outcome.passed) return `- Local checks: ❌ still red ${rounds}`
  return pushed
    ? `- Local checks: ✅ green ${rounds}`
    : `- Local checks: ✅ green in this job ${rounds} — but nothing was pushed, so the branch is unchanged`
}

/** Whether the round pushed, and — when it did not — which of the two reasons. */
const pushedLine = (commit: RoundCommit): string => {
  if (commit.pushed) return '- Pushed a fix: yes'
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
 * A `/retry` here buys another job that re-derives the same blocked edit — the
 * remedy is outside the pipeline entirely.
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

/**
 * What a round that left checks red says about why.
 *
 * "I changed nothing" is only true of a round that wrote nothing. A round whose
 * fix was dropped changed plenty and delivered none of it, and telling that
 * maintainer the agent sat on its hands sends them looking for the wrong
 * problem — the note above has already said where the fix went.
 */
const stillRedNote = (commit: RoundCommit): string => {
  if (commit.pushed)
    return 'I could not get every check green. The pull request has my partial fix; the remaining failures are below.'
  return commit.dropped.length > 0
    ? 'The checks below are still red, and the fix I wrote is not on the branch for the reason above.'
    : 'I could not reproduce or fix the failure locally, so I changed nothing.'
}

const renderCiReport = (
  input: PhaseInput,
  outcome: CheckLoopResult,
  commit: RoundCommit,
  agentRunUrl: string | null,
): string => {
  const { state, deps } = input
  const { pushed } = commit
  const lines = [
    `### CI fix attempt ${state.ciAttempts} of ${deps.config.maxCiAttempts}`,
    '',
    ...runLines(redRunUrl(input), agentRunUrl),
    verdictLine(outcome, pushed),
    pushedLine(commit),
    ...blockedNote(commit.dropped),
  ]

  if (!outcome.passed) {
    lines.push(
      '',
      stillRedNote(commit),
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
