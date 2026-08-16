// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { renderBlock } from './blocks.js'
import { phaseHeading, presentationFor } from './presentation.js'
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
 * is why {@link renderStatus} puts the marker directly below the last section
 * and everything else, the run detail included, below the marker.
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
  /**
   * The hidden blocks this phase wrote — `AGENT_STATE` and any artefact block.
   *
   * They ride on the section rather than on the view because they arrive with
   * it, and they are rendered from it even when {@link fitToBudget} sheds the
   * prose: a trimmed report is a comment that reads short, a trimmed block is a
   * stranded issue.
   */
  blocks: readonly string[]
}

/** Everything the comment is a function of. */
export interface StatusView extends RunDetailView {
  /** Each phase's report, oldest first. Empty for a run that said nothing. */
  sections: readonly ReportSection[]
}

/**
 * How long the rendered comment may be.
 *
 * GitHub refuses an issue comment over 65,536 characters outright, and this is
 * the first design in which one run's whole output lands in one body — while
 * reports were a comment each, the cap was unreachable and nothing measured.
 * The margin below it is deliberate rather than round: `renderStatus` is not the
 * last writer, because the workflow appends the transcript `<details>` to
 * whatever this produced, and a body sized exactly to the cap would fail that
 * edit instead of this render.
 */
export const BODY_BUDGET = 60_000

/** Marks a section clipped to fit, on the side the clipping happened. */
const TRUNCATION_NOTE = '…(truncated)…\n'

/** Says what was dropped, in the place it was dropped from. */
const trimmedNote = (dropped: number): string =>
  dropped === 1
    ? '_(1 earlier section in this run was trimmed — see the run log.)_'
    : `_(${dropped} earlier sections in this run were trimmed — see the run log.)_`

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
 * Everything below the sections, in one place because it is what the budget may
 * never spend: the run's own summary, the marker the prompt layer cuts at, and
 * every section's hidden blocks — oldest first, so "last block in the body wins"
 * resolves to the newest phase's, which is the property `readBlock` already has.
 */
const bookkeeping = (view: StatusView): readonly string[] => [
  // First, and that ordering is the whole contract with `renderThread`: it cuts
  // the body here, so everything after this line is invisible to the model. The
  // run detail is on this side of it because a progress table is bookkeeping —
  // it was the original reason this marker exists — and an HTML comment renders
  // as nothing, so a human sees the disclosure exactly where it was.
  renderBlock(STATUS_MARKER, { run: view.runUrl }),
  '',
  ...renderRunDetail(view),
  ...view.sections.flatMap((section) => section.blocks.flatMap((block) => ['', block])),
]

/**
 * The comment, given a decision about how much of the prose to keep.
 *
 * Split from {@link renderStatus} so the budget can render candidates and
 * measure them rather than predicting their length: the heading, the table and
 * the blocks all vary, and an arithmetic guess at the frame is a second
 * implementation of this function that would drift from it.
 */
const frame = (view: StatusView, prose: readonly string[]): string =>
  [
    // Always the `waiting` stance: this is written once, after the run, so the
    // state it describes is one a maintainer can find the issue in.
    phaseHeading(view.state, 'waiting', presentationFor(view.state, 'waiting').headline),
    '',
    ...prose,
    ...bookkeeping(view),
  ].join('\n')

/**
 * The newest section, clipped from the top so its conclusion survives.
 *
 * The last resort, reached only when one report alone will not fit. From the
 * top rather than the bottom because a report puts its verdict at the end, and
 * a maintainer reading one wants how it came out.
 */
const clipNewest = (view: StatusView, dropped: number, newest: ReportSection): string => {
  const prefix = dropped > 0 ? [trimmedNote(dropped), ''] : []
  const empty = frame(view, [...prefix, ...renderSections([{ ...newest, body: '' }])])
  const room = BODY_BUDGET - empty.length - TRUNCATION_NOTE.length

  const clipped = `${TRUNCATION_NOTE}${newest.body.slice(-Math.max(room, 0))}`
  return frame(view, [...prefix, ...renderSections([{ ...newest, body: clipped }])])
}

/**
 * The whole body, under {@link BODY_BUDGET}.
 *
 * Sheds the **oldest** sections first, one at a time, because the newest is
 * what the maintainer came to read and its predecessors are the same job's
 * earlier phases. Nothing in {@link bookkeeping} is ever a candidate.
 *
 * A run whose blocks alone exceed the budget is returned over it, deliberately:
 * the alternative is dropping the run's memory to fit its prose, and a comment
 * GitHub refuses is a better failure than an issue that restores wrong.
 */
const fitToBudget = (view: StatusView): string => {
  const full = frame(view, renderSections(view.sections))
  if (full.length <= BODY_BUDGET || view.sections.length === 0) return full

  const shed = view.sections.slice(1).reduce<string | null>((found, _section, index) => {
    if (found !== null) return found
    const kept = view.sections.slice(index + 1)
    const body = frame(view, [trimmedNote(index + 1), '', ...renderSections(kept)])
    return body.length <= BODY_BUDGET ? body : null
  }, null)
  if (shed !== null) return shed

  const newest = view.sections.at(-1)
  return newest === undefined ? full : clipNewest(view, view.sections.length - 1, newest)
}

/**
 * The whole comment.
 *
 * The heading's glyph and headline come from the presentation table and nothing
 * else: "🛠️ Implementing" would be a third name for a phase that already has a
 * label suffix and a headline, and inventing one per renderer is the defect that
 * table exists to prevent. One heading for the run, however many sections it
 * carries — the sections speak for their own phases.
 */
export const renderStatus = (view: StatusView): string => fitToBudget(view)
