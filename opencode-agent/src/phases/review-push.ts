// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PhaseInput } from '../phase-context.js'
import { protectedAmong } from '../protected-paths.js'
import { errorMessage } from '../types.js'

/**
 * Making the loop's findings durable, as they land rather than at the end.
 *
 * Three facts force this shape. The loop's fixes are **commits it makes itself**,
 * in a worktree of this checkout, merged onto the working branch by the loop —
 * so `commitAll` has nothing to stage and cannot say whether anything happened;
 * only `HEAD` can. An Actions working tree **dies with the job**, so a fix is
 * worth nothing until it is pushed, and run 31704544065 lost an hour of review
 * to a runner that went away. And the credential belongs to the **pipeline**,
 * never to a subprocess whose children the model can read the environment of, so
 * the push cannot happen inside the loop that produces the fixes — it happens
 * here, on a marker the loop prints.
 *
 * The pushes ride a promise chain rather than being awaited at the call site:
 * the marker arrives on the child's stdout, mid-turn, where nothing can be
 * awaited, and two markers in quick succession must not push concurrently.
 */
export interface DurablePush {
  /** Handed to the loop, called when a fix lands. Never throws. */
  onFixMerged: () => void
  /** Resolves once every push the markers asked for has been tried. */
  settled: () => Promise<void>
  /**
   * Pushes if the branch has moved since the last push; resolves whether it ever
   * moved.
   *
   * `committed` is what this process itself just did: a commit has moved `HEAD`
   * by definition, so it needs no second opinion from the checkout — and asking
   * for one would make a push conditional on a read that is allowed to fail.
   */
  push: (committed: boolean) => Promise<boolean>
  /** Paths reverted because a push could not carry them, across every push made. */
  blocked: () => readonly string[]
}

/**
 * `HEAD`, or `null` when the checkout would not say.
 *
 * `null` is "unknown", never "unchanged": it makes the comparison below fail
 * open, so a checkout that cannot answer pushes rather than deciding on no
 * evidence that there was nothing to push. Pushing an unmoved branch is free.
 */
const readHead = async (input: PhaseInput): Promise<string | null> => {
  const { deps, state } = input
  try {
    return await deps.git.headSha()
  } catch (error) {
    deps.log.warn({ issue: state.issueId, error: errorMessage(error) }, 'Could not read HEAD; will push regardless')
    return null
  }
}

/**
 * Takes back out anything the loop committed that a push cannot carry.
 *
 * `stageAllowed` guards every commit *this process* makes, and it is not on this
 * path at all: the loop commits in its own worktree and merges the result, so
 * those files never pass through an index this pipeline stages. Left alone they
 * reach `git push`, which GitHub refuses for the whole push — and the branch is
 * the only copy of the findings, on a runner about to be deleted.
 *
 * Reverting rather than refusing, for the reason `stageAllowed` drops rather
 * than refuses: refusing here loses exactly the work the remote would have lost.
 *
 * Best-effort, and that is a judgement about which failure is worse. If the
 * revert itself breaks, the push that follows is the one GitHub was always going
 * to refuse — the same outcome as before this existed — whereas letting it throw
 * would turn a review that found real problems into a failed run. What it must
 * not do is stay quiet: the paths it reverted ride out into the phase's report.
 */
const dropUnpushable = async (input: PhaseInput, since: string, blocked: string[]): Promise<void> => {
  const { deps, state } = input
  try {
    const unpushable = protectedAmong(await deps.git.changedSince(since))
    if (unpushable.length === 0) return

    await deps.git.revertPaths(since, unpushable)
    blocked.push(...unpushable.filter((path) => !blocked.includes(path)))
  } catch (error) {
    deps.log.warn(
      { issue: state.issueId, error: errorMessage(error) },
      'Could not revert what this pipeline cannot push; the push may be refused',
    )
  }
}

/**
 * Everything that belongs between deciding to push and the push itself.
 *
 * Reconcile before the protected-path revert, not after it: a reconciling
 * merge can bring the human line's own commits in, and only once it has
 * landed can `dropUnpushable` see — and take back out — a path a push cannot
 * carry. The other order lets a workflow file ride the merge into a push
 * GitHub refuses whole (the issue #240 failure class). `push` reconciles
 * again internally, idempotently — the ancestor check answers "already
 * merged".
 */
const guardBeforePush = async (input: PhaseInput, branch: string, since: string, blocked: string[]): Promise<void> => {
  await input.deps.git.reconcile(branch)
  await dropUnpushable(input, since, blocked)
}

export const createPush = (input: PhaseInput, branch: string): DurablePush => {
  const { deps, state } = input
  // Accumulated across every push this loop makes, because the marker fires per
  // fix and only the last one reaches the report.
  const blocked: string[] = []
  // Read now — before the loop is started by the caller — because what every
  // comparison below means is "since the review began".
  let pushedAt: Promise<string | null> = readHead(input)
  let advanced = false
  let chain: Promise<void> = Promise.resolve()

  const pushIfMoved = async (committed: boolean): Promise<boolean> => {
    const [last, head] = await Promise.all([pushedAt, readHead(input)])
    if (!committed && last !== null && head !== null && last === head) return advanced

    if (last !== null) await guardBeforePush(input, branch, last, blocked)
    // The head this push is about to carry, read after the guard and before
    // the ref moves. Not `head` above, which predates the guard's revert
    // (run 32992114904); not after the push either — the loop's child merges
    // each fix into this checkout unsynchronized with this push, so a fix
    // landing mid-push is not carried, and a post-push read records a head
    // the remote never accepted, skipping that fix's next push. Read here,
    // the record can only fall short of what was carried — a redundant push,
    // never a lost fix — and only a successful push advances it: refusals retry.
    const carried = readHead(input)
    await deps.git.push(branch)
    pushedAt = carried
    advanced = true
    return advanced
  }

  return {
    onFixMerged: (): void => {
      chain = chain.then(async () => {
        try {
          await pushIfMoved(false)
          deps.log.info({ issue: state.issueId, branch }, 'Pushed a review fix as it landed')
        } catch (error) {
          // Not the run's failure: the final push tries again, and a review that
          // cannot reach the remote mid-loop is still worth finishing.
          deps.log.warn({ issue: state.issueId, branch, error: errorMessage(error) }, 'Could not push a review fix')
        }
      })
    },
    settled: (): Promise<void> => chain,
    push: (committed) => pushIfMoved(committed),
    blocked: (): readonly string[] => blocked,
  }
}
