// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PhaseInput } from '../phase-context.js'
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

export const createPush = (input: PhaseInput, branch: string): DurablePush => {
  const { deps, state } = input
  // Read now — before the loop is started by the caller — because what every
  // comparison below means is "since the review began".
  let pushedAt: Promise<string | null> = readHead(input)
  let advanced = false
  let chain: Promise<void> = Promise.resolve()

  const pushIfMoved = async (committed: boolean): Promise<boolean> => {
    const [last, head] = await Promise.all([pushedAt, readHead(input)])
    if (!committed && last !== null && head !== null && last === head) return advanced

    await deps.git.push(branch)
    pushedAt = Promise.resolve(head)
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
  }
}
