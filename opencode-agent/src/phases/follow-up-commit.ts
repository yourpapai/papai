// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CheckFailure, CheckRunner, CheckSpec } from '../check-loop.js'
import { truncateOutput } from '../check-loop.js'
import { buildCommitRepairPrompt, commitWithRepair } from '../commit-repair.js'
import { isWorkflowPushForbidden } from '../errors.js'
import { renderFollowUpApplied, renderFollowUpChecksRed, renderFollowUpFailure } from '../follow-up-notices.js'
import type { Applied } from '../follow-up-prompts.js'
import { FOLLOW_UP_APPLY_INSTRUCTIONS } from '../follow-up-prompts.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { OpenCodeAgent } from '../opencode-adapter.js'
import type { MachineInput } from '../phase-context.js'
import type { UntrustedEnvelope } from '../prompts.js'
import { mapSeries } from '../sequence.js'

/**
 * The pipeline's half of a small verdict — what applying one costs.
 *
 * Split from `phases/follow-up.ts` along the `implement-commit.ts` seam: that
 * module decides whether the request is small enough to attempt at all, and
 * this one is about what committing it comes to and what the repository will
 * accept. Everything here is the pipeline's alone — the model never runs git —
 * and the order is the design:
 *
 * 1. **Checks first, judged by exit status only.** The commands the apply turn
 *    named are re-run by the pipeline beside `AGENT_CHECK_COMMAND` through the
 *    `CheckRunner` seam — trusting the model's green is exactly what run
 *    31779566286 punished. Red means no commit of record, no push, and the
 *    branch left exactly as the command found it.
 * 2. **The commit under repair.** The repository's own pre-commit hook gets to
 *    reject the tree, the model gets to fix what it printed, bounded by
 *    `AGENT_COMMIT_REPAIR_MAX_ROUNDS`; only a `GitError` is repaired, so no
 *    round can talk the pipeline into committing a staged credential.
 * 3. **Reconcile by merge before the push** — never rebase, never force; the
 *    branch is shared with humans. The sha the reply names is the head the
 *    remote accepted, read **after** the push.
 */

/** How a follow-up ended, as the comment and run status it earns. */
export interface FollowUpEnd {
  status: 'completed' | 'failed'
  reason: string
  comment: string
}

export const applyAndPush = async (
  input: MachineInput,
  branch: string,
  verdictReason: string,
  applied: Applied,
  envelope: UntrustedEnvelope,
  agent: OpenCodeAgent,
): Promise<FollowUpEnd> => {
  const { state, deps } = input
  const checks = checksFor(applied, deps.config.checkCommand)

  const red = await redChecksEnd(input, checks, deps.runCheck)
  if (red !== null) return red

  const committed = await commitWithRepair({
    commit: () => deps.git.commitAll(followUpMessage(state.issueId, applied.summary)),
    repair: repairWith(input, envelope, agent),
    maxRounds: deps.config.commitRepairMaxRounds,
    log: deps.log,
    issue: state.issueId,
  })

  if (committed.kind !== 'committed') return uncommittedEnd(branch, verdictReason, applied, checks, committed)
  return pushCommitted(input, branch, verdictReason, applied, checks, committed.dropped)
}

/** The commands the apply turn named, plus the repository's own command. */
const checksFor = (applied: Applied, checkCommand: string): readonly CheckSpec[] => [
  ...applied.testCommands.map((command) => ({ name: command, argv: command.split(' ') })),
  { name: checkCommand, argv: checkCommand.split(' ') },
]

/** The red verdict: no commit of record, no push, the branch left as found. */
const redChecksEnd = async (
  input: MachineInput,
  checks: readonly CheckSpec[],
  run: CheckRunner,
): Promise<FollowUpEnd | null> => {
  const failures = await judgeChecks(checks, run)
  if (failures.length === 0) return null
  input.deps.log.warn(
    { issue: input.state.issueId, failed: failures.map((failure) => failure.name) },
    'Follow-up checks red; nothing pushed',
  )
  return {
    status: 'failed',
    reason: `The follow-up failed its checks: ${failures.map((failure) => failure.name).join(', ')}`,
    comment: renderFollowUpChecksRed(
      checks.map((check) => check.name),
      failures,
      input.state.prUrl,
    ),
  }
}

/** One repair turn under the handler's own system prompt, envelope and rules. */
const repairWith =
  (input: MachineInput, envelope: UntrustedEnvelope, agent: OpenCodeAgent) =>
  async (rejection: import('../commit-repair.js').CommitRejection, round: number): Promise<void> => {
    const { state, deps } = input
    await agent.prompt({
      system: composeSystemPrompt({
        phase: state.phase,
        skills: [],
        repoRoot: deps.config.repoRoot,
        nonce: envelope.nonce,
        instructions: FOLLOW_UP_APPLY_INSTRUCTIONS,
      }),
      prompt: buildCommitRepairPrompt(envelope, rejection, round),
      agent: 'build',
    })
  }

/**
 * `clean` and `blocked` take the same branch — there is nothing to push either
 * way — but only one of them has anything to tell a maintainer.
 */
const uncommittedEnd = (
  branch: string,
  verdictReason: string,
  applied: Applied,
  checks: readonly CheckSpec[],
  committed: Exclude<import('../git-commit.js').CommitOutcome, { kind: 'committed' }>,
): FollowUpEnd => ({
  status: 'completed',
  reason: `The follow-up made no commit on ${branch}`,
  comment: renderFollowUpApplied({
    reason: verdictReason,
    summary: applied.summary,
    files: committed.kind === 'blocked' ? applied.files : [],
    checks: checks.map((check) => check.name),
    sha: 'nothing to push — no commit was made',
    dropped: committed.kind === 'blocked' ? committed.dropped : [],
  }),
})

/**
 * Reconcile by merge, push, and read the head the remote accepted. The one
 * translated push refusal is the workflows-permission sentence — its remedy is
 * the update-branch control, and everything else is an ordinary broken run.
 */
const pushCommitted = async (
  input: MachineInput,
  branch: string,
  verdictReason: string,
  applied: Applied,
  checks: readonly CheckSpec[],
  dropped: readonly string[],
): Promise<FollowUpEnd> => {
  const { state, deps } = input
  await deps.git.reconcile(branch)
  try {
    await deps.git.push(branch)
  } catch (error) {
    if (!isWorkflowPushForbidden(error)) throw error
    deps.log.warn({ issue: state.issueId }, 'The follow-up push was refused: the token may not push workflow changes')
    return {
      status: 'failed',
      reason: 'The push was refused: the token may not push workflow changes',
      comment: renderFollowUpFailure(
        state.phase,
        branch,
        'The commit was made on the branch, but the push was refused: this pipeline\u2019s token may not push changes to ' +
          'files under `.github/workflows/`. A maintainer can push it from the pull request\u2019s own Update branch control.',
      ),
    }
  }
  const sha = await deps.git.headSha()

  return {
    status: 'completed',
    reason: `Applied the follow-up on ${branch} and pushed ${sha}`,
    comment: renderFollowUpApplied({
      reason: verdictReason,
      summary: applied.summary,
      files: applied.files,
      checks: checks.map((check) => check.name),
      sha,
      dropped,
    }),
  }
}

/** Runs every check once through the `CheckRunner` seam, judged by exit status. */
const judgeChecks = async (checks: readonly CheckSpec[], run: CheckRunner): Promise<CheckFailure[]> => {
  const results = await mapSeries(checks, async (check) => ({ check, result: await run(check) }))
  return results
    .filter(({ result }) => result.exitCode !== 0)
    .map(({ check, result }) => ({
      name: check.name,
      exitCode: result.exitCode,
      output: truncateOutput(result, 4000),
    }))
}

const followUpMessage = (issue: number, summary: string): string =>
  `fix(agent): follow-up request on issue #${issue}\n\n${summary}\n\nRefs #${issue}`
