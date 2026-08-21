// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { join } from 'node:path'

import { isWorkflowPushForbidden } from '../errors.js'
import { branchNameFor } from '../git.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { MachineInput } from '../phase-context.js'
import type { UntrustedEnvelope } from '../prompts.js'
import { postAnswer } from '../run-post.js'
import type { RunResult } from '../run-result.js'
import {
  renderExhausted,
  renderMerged,
  renderPushForbidden,
  renderResolved,
  renderSyncFailure,
  renderSyncOverBudget,
  renderUpToDate,
} from '../sync-notices.js'
import { totalTokens, withinBudget } from '../token-budget.js'
import { errorMessage } from '../types.js'
import { mintEnvelope } from './envelope.js'

/**
 * The `/sync` side operation: merge the base branch into the agent branch and
 * push, from any state whose pull-request number is set.
 *
 * The `answer.ts` precedent — a handler that is not a phase. It runs from
 * `driveMachine` ahead of both budget stops, because a `/sync` owns its own
 * ceilings: the clean path spends nothing, so it must work **at** the token
 * ceiling, and the wall-clock stop parks in `INCOMPLETE` — a state move, which
 * is the one thing `/sync` exists never to make. No signal, no transition, no
 * `attempts`: phase, `resumeFrom` and every per-PR budget leave exactly as they
 * arrived, in every outcome, which is what makes `/sync` safe to accept in
 * `COMPLETE`, `FAILED` and `INCOMPLETE` alike.
 *
 * The reply is `postAnswer`'s write — a plain comment on the trigger surface,
 * deliberately not a record — and the only thing that may change on the thread
 * is the running token total a repair turn paid, rewritten in place through
 * `state-persist.ts` inside that same write. What the reply *says* lives next
 * door, in `sync-notices.ts`.
 */

/** One conflicted path with the marked content the repair prompt carries. */
interface ConflictEntry {
  path: string
  content: string
}

/**
 * The forbidden-git rule of the sync repair prompt, pinned by
 * `instructions.test.ts` beside `PROTECTED_PATHS_RULE`.
 *
 * The same doctrine `commit-repair.ts` states, for a model holding `bash` over
 * a mid-merge index: "the merge conflicted" reads to it as an invitation to
 * finish the merge itself, and a `git` command from inside the repair turn
 * could wedge the very index the pipeline is relying on to complete or abort.
 */
export const SYNC_FORBIDDEN_GIT_RULE =
  'Do not run git yourself: do not merge, do not commit, do not stage, do not abort. The pipeline completes the ' +
  'merge and pushes the moment you finish; a git command from you could break the merge state the pipeline relies on.'

const SYNC_REPAIR_INSTRUCTIONS = [
  'A merge of the base branch into this working tree conflicted and you are resolving the markers.',
  'Keep both sides\u2019 intent unless one side deleted what the other changed; never drop a change to end a conflict.',
  SYNC_FORBIDDEN_GIT_RULE,
].join('\n')

/** How the sync ended, as one comment plus the run status it earns. */
interface SyncEnd {
  status: 'completed' | 'failed'
  reason: string
  comment: string
}

export const runSync = async (input: MachineInput): Promise<RunResult> => {
  const { state, deps } = input
  const branch = branchNameFor(state.issueId)
  const base = await deps.baseBranch()
  deps.log.info({ issue: state.issueId, branch, base, phase: state.phase }, 'Running the /sync side operation')

  try {
    await deps.git.ensureBranch(branch, base)
    const end = await syncEnd(input, branch, base, await deps.git.mergeBase(base))
    return await finish(input, end)
  } catch (error) {
    const message = errorMessage(error)
    deps.log.error({ issue: state.issueId, branch, base, error: message }, 'The /sync side operation failed')
    return finish(input, {
      status: 'failed',
      reason: message,
      comment: renderSyncFailure(state.phase, branch, base, message),
    })
  }
}

/** The three ways a merge can land, as the end this run reports for each. */
const syncEnd = async (
  input: MachineInput,
  branch: string,
  base: string,
  merged: import('../git.js').MergeOutcome,
): Promise<SyncEnd> => {
  if (merged.kind === 'up-to-date') {
    return {
      status: 'completed',
      reason: `Branch ${branch} already contains ${base}`,
      comment: renderUpToDate(branch, base),
    }
  }
  if (merged.kind === 'clean') {
    const refused = await pushOrRefuse(input, base)
    if (refused !== null) return refused
    return {
      status: 'completed',
      reason: `Merged ${merged.commits} commits of ${base} into ${branch}`,
      comment: renderMerged(merged.commits, branch, base),
    }
  }
  return repairRounds(input, base, merged.paths)
}

/**
 * Pushes the merged branch, translating the one refusal this merge can trigger
 * by design. Any other push error is rethrown and reported by the outer catch
 * as an ordinary broken run — only the workflows-permission sentence has a
 * remedy this reply can name, and the matcher stays that narrow.
 */
const pushOrRefuse = async (input: MachineInput, base: string): Promise<SyncEnd | null> => {
  const { deps, state } = input
  try {
    await deps.git.push(branchNameFor(state.issueId))
    return null
  } catch (error) {
    if (!isWorkflowPushForbidden(error)) throw error
    deps.log.warn({ issue: state.issueId }, 'The sync push was refused: the token may not push workflow changes')
    return {
      status: 'failed',
      reason: 'The push was refused: the token may not push workflow changes',
      comment: renderPushForbidden(base, state.prUrl),
    }
  }
}

/**
 * Bounded repair rounds over the marked files — the `commit-repair` doctrine
 * on a merge: the model edits markers, is forbidden git, and the pipeline
 * alone completes the merge and pushes.
 *
 * The ceiling is asked **before** each turn, the `applyIntent` rule: never pay
 * to learn what a refusal would say. Over budget, no turn starts — the reply
 * names the ceiling and the human remedy, and the merge is aborted so the
 * branch is left exactly as `/sync` found it.
 */
const repairRounds = (input: MachineInput, base: string, initial: readonly string[]): Promise<SyncEnd> => {
  const { state, deps } = input
  const branch = branchNameFor(state.issueId)

  const envelope = mintEnvelope()
  const system = composeSystemPrompt({
    phase: state.phase,
    skills: [],
    repoRoot: deps.config.repoRoot,
    nonce: envelope.nonce,
    instructions: SYNC_REPAIR_INSTRUCTIONS,
  })

  const round = async (n: number, paths: readonly string[]): Promise<SyncEnd> => {
    const spent = await totalTokens(deps, input.carriedTokens)
    if (!withinBudget(spent, deps.config)) {
      await deps.git.abortMerge()
      deps.log.warn({ issue: state.issueId, round: n, spent }, 'No sync repair turn: at the token ceiling')
      return {
        status: 'failed',
        reason: `Token budget spent (${spent} of ${deps.config.maxTokens} tokens for this issue)`,
        comment: renderSyncOverBudget(spent, deps.config.maxTokens, branch, base, state.prUrl),
      }
    }

    const entries = await readConflicts(input, paths)
    await (
      await deps.agent()
    ).prompt({ system, prompt: buildSyncRepairPrompt(envelope, base, entries, n), agent: 'build' })

    const remaining = await unresolvedPaths(input, paths)
    if (remaining.length === 0) return resolved(input, base, n)
    if (n >= deps.config.syncRepairMaxRounds) return exhausted(input, base, n, remaining)

    return round(n + 1, remaining)
  }

  return round(1, initial)
}

/** The merge resolved: complete it, push it, report it. */
const resolved = async (input: MachineInput, base: string, rounds: number): Promise<SyncEnd> => {
  const { state, deps } = input
  const branch = branchNameFor(state.issueId)
  await deps.git.completeMerge(`chore(agent): sync with ${base}\n\nRefs #${state.issueId}`)
  const refused = await pushOrRefuse(input, base)
  if (refused !== null) return refused
  return {
    status: 'completed',
    reason: `Resolved the ${base} merge conflicts on ${branch}`,
    comment: renderResolved(rounds, branch, base),
  }
}

/** The rounds are spent: abort, leave the branch as it was, name the remedy. */
const exhausted = async (
  input: MachineInput,
  base: string,
  rounds: number,
  remaining: readonly string[],
): Promise<SyncEnd> => {
  const { state, deps } = input
  const branch = branchNameFor(state.issueId)
  await deps.git.abortMerge()
  deps.log.warn(
    { issue: state.issueId, round: rounds, unresolved: remaining },
    'Sync repair rounds exhausted; merge aborted',
  )
  return {
    status: 'failed',
    reason: `Every sync repair round ended with conflict markers still present (${remaining.join(', ')})`,
    comment: renderExhausted(rounds, deps.config.syncRepairMaxRounds, branch, base, remaining, state.prUrl),
  }
}

/** Reads the conflicted files as they stand right now. */
const readConflicts = async (input: MachineInput, paths: readonly string[]): Promise<ConflictEntry[]> => {
  const contents = await Promise.all(paths.map((path) => input.deps.readFile(join(input.deps.config.repoRoot, path))))
  return paths.map((path, index) => ({ path, content: contents[index] ?? '' }))
}

/** Which of `paths` still carry conflict markers, after a repair turn. */
const unresolvedPaths = async (input: MachineInput, paths: readonly string[]): Promise<string[]> => {
  const contents = await readConflicts(input, paths)
  return contents.filter((entry) => hasMarkers(entry.content)).map((entry) => entry.path)
}

const MARKER_LINE = /^(<{7}|>{7}|={7}($| ))/u

/** Conflict markers as git writes them, at line starts. */
const hasMarkers = (content: string): boolean => content.split('\n').some((line) => MARKER_LINE.test(line))

/**
 * The one exit every outcome takes: the reply is `postAnswer`'s write — a
 * plain comment on the trigger surface carrying **no state block** — and the
 * spend the run paid is folded into the state that write persists in place.
 * Nothing else about the state changes in any outcome, which is the whole
 * "non-moving" contract of the command.
 */
const finish = async (input: MachineInput, end: SyncEnd): Promise<RunResult> => {
  const spent = await totalTokens(input.deps, input.carriedTokens)
  const carried = { ...input.state, tokensSpent: spent }
  await postAnswer(input.thread, input, end.comment, carried)

  return { status: end.status, reason: end.reason, state: carried, reported: true }
}

/**
 * The repair prompt: conflicted paths named, marked regions carried, git
 * forbidden. The file contents are enveloped for the reason check output is —
 * the files are the repository's own, written by contributors, and this text
 * is going into a prompt.
 */
export const buildSyncRepairPrompt = (
  envelope: UntrustedEnvelope,
  base: string,
  entries: readonly ConflictEntry[],
  round: number,
): string =>
  [
    `Merging origin/${base} into this branch conflicted (repair round ${round}). The conflicted files and their ` +
      'current contents are below; each still carries git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).',
    ...entries.map((entry) => `## ${entry.path}\n${envelope.wrap('conflicted-file', entry.content)}`),
    'Edit each conflicted file in the working tree: remove every conflict marker and write the resolution that keeps ' +
      'both sides\u2019 intent. Do not touch files that are not listed.',
    SYNC_FORBIDDEN_GIT_RULE,
    'Reply with a one-paragraph summary of how you resolved each conflict.',
  ].join('\n\n')
