// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { renderBlock } from './blocks.js'
import { phaseHeading, presentationFor } from './presentation.js'
import type { RunStance } from './presentation.js'
import { renderRunDetail } from './run-detail.js'
import type { RunDetailView } from './run-detail.js'

/**
 * What the run's one comment says.
 *
 * Pure: every input arrives as an argument, including the clock, so the whole
 * rendering is testable as a value and the channel that posts it has nothing to
 * decide but *when*.
 *
 * **One comment per run, posted once, when the run ends.** The pipeline used to
 * open this at the start and edit it as the run moved, beside a second comment
 * per phase carrying the report; both are now this. A maintainer's command
 * draws exactly one reply, and because it is a *post* rather than an edit,
 * GitHub notifies when the answer lands rather than when the run started.
 *
 * It carries the run's hidden blocks — `AGENT_STATE` among them — which the live
 * version deliberately did not. That reversal is safe for the reason it was
 * unsafe before: there is no longer a second comment for the restore scan to
 * choose between. `readBlock` returns the *last* block of a marker in a body and
 * `locateLatestBlock` walks the thread newest-first, so "newest wins" is
 * unchanged whether a run wrote four comments or one. The blocks are appended by
 * the buffer, below what this renders.
 *
 * It also carries a block of its own, under {@link STATUS_MARKER}, and that is
 * not a hedge on the rule above — `findLatestBlock` matches a marker exactly, so
 * `AGENT_STATUS` cannot be mistaken for `AGENT_STATE` by the scan or by
 * `readBlock`. The marker's job changed with the comment: it used to mean "drop
 * this comment from the prompt", which is no longer possible now that the
 * answer, the design digest and the plan all live here. It now means *the
 * bookkeeping starts here*, and `renderThread` truncates the body at it — which
 * is why {@link renderStatus} always puts the run detail last of the visible
 * body, immediately above it.
 */

/**
 * Marks the point where this comment stops speaking to a human and starts
 * speaking to the pipeline.
 *
 * Deliberately **not** `AGENT_STATE`, and deliberately not a variant of it: the
 * restore scan matches a marker exactly, and the two are read by different
 * layers for opposite reasons — one to be believed, one to be cut at.
 *
 * The string is held at `AGENT_STATUS` rather than renamed alongside the
 * behaviour, because old threads carry it and the prompt layer reads it on
 * historical comments.
 */
export const STATUS_MARKER = 'AGENT_STATUS'

/**
 * One phase's report, as it appears in the run's comment.
 *
 * Terminal by construction: a section is written from a finished `PhaseOutcome`,
 * so it is rendered once and never revisited. The summary is the phase's own
 * headline, read from the one presentation table by whoever appends it, so a
 * section cannot acquire a name no other surface uses.
 */
export interface ReportSection {
  summary: string
  body: string
}

/** Everything the comment is a function of. */
export interface StatusView extends RunDetailView {
  /** Each phase's report, oldest first. Empty for a run that said nothing. */
  sections: readonly ReportSection[]
}

/**
 * The sections, oldest first, with every one but the newest folded away.
 *
 * The newest is left open because it is what the maintainer came to read; the
 * ones before it are the same job's earlier phases, which are context rather
 * than news. A single-section run — the common case — therefore renders exactly
 * as a bare report, with no disclosure widget at all.
 *
 * Bodies are placed, never parsed: a section is model-written markdown in which
 * headings, fences and `---` rules are ordinary, and reflowing one is how a
 * renderer corrupts a report it does not understand.
 */
const renderSections = (sections: readonly ReportSection[]): readonly string[] =>
  sections.flatMap((section, index) =>
    index === sections.length - 1
      ? [section.body, '']
      : [`<details><summary>${section.summary}</summary>`, '', section.body, '', '</details>', ''],
  )

/**
 * The whole comment.
 *
 * The heading's glyph and headline come from the presentation table and nothing
 * else: "🛠️ Implementing" would be a third name for a phase that already has a
 * label suffix and a headline, and inventing one per renderer is the defect that
 * table exists to prevent. One heading for the run, however many sections it
 * carries — the sections speak for their own phases.
 */
export const renderStatus = (view: StatusView): string => {
  const stance: RunStance = view.live ? 'working' : 'waiting'
  const { headline } = presentationFor(view.state, stance)

  return [
    phaseHeading(view.state, stance, view.live ? `${headline} — run in progress` : headline),
    '',
    ...renderSections(view.sections),
    ...renderRunDetail(view),
    '',
    // The marker the prompt layer cuts at, carrying the run it belongs to so a
    // reader of the raw thread can tell two runs' comments apart.
    renderBlock(STATUS_MARKER, { run: view.runUrl }),
  ].join('\n')
}
