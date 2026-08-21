// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { providerStalledError } from './errors.js'
import type { ProgressTracker } from './progress.js'
import type { TurnBounds } from './turn-run.js'

/**
 * The way a turn ends badly that does not arrive as a rejection: it returns,
 * and the model never answered.
 *
 * Split from `turn-run.ts` when the stall watcher pushed that file past
 * `max-lines`, along the seam its own header already drew — `turn-run.ts` owns
 * a turn's *outstanding* time (the bounds, the heartbeat, the race), this owns
 * the judgement of the one ending that comes back as an ordinary value. The
 * adapter calls both, in that order, and neither imports the other's half.
 *
 * The turn resolves normally, the reply decodes normally, and there is simply
 * nothing in it, because the session spent its whole time being refused by the
 * provider and then gave up. Issue #239 shipped a pull request out of that: an
 * empty turn, a `git add --all` over a tree holding one stray pid file, and a
 * delivery.
 *
 * **Both** signals are required, and neither is sufficient. An empty reply on
 * its own is a shape a healthy turn can reach — this pipeline discards the text
 * of an implement turn precisely because it does not depend on it — so failing
 * on it alone would fail runs that worked. A stall on its own says only that
 * the provider had a bad minute somewhere in a turn that then recovered, which
 * the tracker already reports by clearing it at the next finished step. Together
 * they are the thing itself: no answer, and the provider still failing at the
 * moment the session stopped trying.
 *
 * Takes the tracker rather than a pre-read stall so the read happens **after**
 * the turn returns, which is the only instant that answers the question.
 */
export const requireAnswer = (text: string, tracker: ProgressTracker, bounds: TurnBounds): void => {
  if (text.trim().length > 0) return

  const stall = tracker.stall()
  if (stall === null) return

  bounds.log.error(
    { retries: stall.retries, error: stall.failure?.name ?? null, statusCode: stall.failure?.statusCode ?? null },
    'The turn returned with no answer while the provider was still failing; failing the turn rather than ' +
      'committing whatever the tree holds',
  )
  throw providerStalledError(stall)
}
