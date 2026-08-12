// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { findLatestBlock, renderBlock } from './blocks.js'
import type { IssueComment } from './blocks.js'

/**
 * Artefacts the pipeline writes once and reads back in a later job: the
 * implementation report and the wall-clock handoff.
 *
 * Each is persisted in its own hidden block rather than recovered by matching a
 * markdown heading in the visible comment. That distinction matters: these
 * payloads are model-written markdown full of headings and `---` rules, and any
 * scraping scheme truncates them the moment the model writes one.
 *
 * The design spec and the plan used to travel here too (`AGENT_SPEC`/
 * `AGENT_PLAN`); under the OpenSpec rework (design D1) they live in the change
 * folder on the branch, so only the report and the handoff remain as blocks.
 */
export const REPORT_MARKER = 'AGENT_REPORT'
/**
 * The handoff a wall-clock stop leaves for the `/continue` that follows it: what
 * the interrupted turn finished, what remains, and what it tried that did not work.
 *
 * A block like the report rather than a heading in the notice, for the reason
 * this module exists at all — it is model-written markdown full of headings and
 * lists, and every scraping scheme truncates that the moment the model writes
 * one. It is also the artefact with the most to lose from a bad recovery: the
 * "tried and did not work" section is the one thing a fresh session cannot
 * re-derive from the diff and the plan, so a truncated read is not a cosmetic
 * loss, it is a continuation re-treading ground somebody already paid for.
 */
export const HANDOFF_MARKER = 'AGENT_HANDOFF'

/**
 * Input to {@link renderDigest}: where the artifact lives on the branch, and
 * the machine identity a park tracks (if any).
 */
export interface DigestMeta {
  /** The OpenSpec change folder the artifact was read from. */
  readonly changeName: string
  /** The branch carrying the folder — the artifact's real history (its commits). */
  readonly branch: string
  /**
   * The plan-identity token, when the digest is rendered at `PLAN_REVIEW`.
   * `null` at `DESIGN_SPEC`: the proposal has no revision counter (the retired
   * `specRevision` is gone), so its history is the branch's commits alone.
   */
  readonly revision: number | null
}

const artifactSchema = z.object({
  text: z.string().min(1),
  revision: z.number().int().min(0).default(0),
})

export type Artifact = z.infer<typeof artifactSchema>

/** Renders the hidden block that carries an artefact to the next job. */
export const renderArtifact = (marker: string, text: string, revision: number): string =>
  renderBlock(marker, { text, revision })

/**
 * Renders a folder artifact as a park digest (design D1: the folder is truth;
 * comments are renders).
 *
 * The two human parks (`DESIGN_SPEC`, `PLAN_REVIEW`) each show a snapshot of
 * what landed in `openspec/changes/<name>/` — the proposal at `DESIGN_SPEC`,
 * `tasks.md` at `PLAN_REVIEW` — read straight back from the folder rather than
 * remembered from the model reply. The digest carries the branch as the history
 * of record (the folder's commits are the artifact's real history) and, for the
 * plan, the revision token the machine uses to tell two plans apart.
 *
 * It does not carry the artifact itself as truth: a rendered snapshot that
 * pretended to be the artifact would be two truths, exactly the drift the
 * `AGENT_SPEC`/`AGENT_PLAN` blocks retired. The content rides inside a
 * `<details>` block so a long tasks.md does not dominate the issue thread, and
 * it is the content read from the folder verbatim — the park reviews what the
 * branch carries, not a paraphrase of it.
 */
export const renderDigest = (content: string, meta: DigestMeta): string => {
  const history =
    meta.revision === null
      ? `openspec/changes/${meta.changeName}/ on \`${meta.branch}\``
      : `openspec/changes/${meta.changeName}/ on \`${meta.branch}\` · plan revision ${meta.revision}`
  return [
    '<details><summary>Folder digest</summary>',
    '',
    `Source of truth: \`${history}\`.`,
    '',
    content.trim(),
    '',
    '</details>',
  ].join('\n')
}

/** Reads the newest agent-authored artefact of this kind; `null` when absent. */
export const findArtifact = (thread: readonly IssueComment[], agentLogin: string, marker: string): Artifact | null => {
  const result = artifactSchema.safeParse(findLatestBlock(thread, agentLogin, marker))
  return result.success ? result.data : null
}

/**
 * The handoff a continuation should read, or `null` when there is none it should.
 *
 * Its **lifecycle** is the whole reason this is a function rather than a
 * `findArtifact` call at the call site, and it has three parts:
 *
 *  - it is **written** by a stop that was interrupted part-way through a plan;
 *  - it is **superseded** by the next one, for free — the blocks are appended to the
 *    thread in order and `findArtifact` walks newest-first, so a second stop's note
 *    is the one a third job reads;
 *  - it is **retired** by a new plan, which is what the revision stamp is for. The
 *    note describes progress against the plan the interrupted turn was implementing,
 *    so a `/changes` that re-plans makes every claim in it a statement about work
 *    nobody asked for any more — "done", "remaining" and "rejected" all measured
 *    against a document that has been replaced. Stamped with `planRevision` and read
 *    back only on a match, exactly as the report block records which plan it
 *    implemented.
 *
 * What deliberately does **not** retire it is a `/retry` after a failed
 * implementation of the same plan: the branch still carries the work the note
 * describes, so it is still the best account of where things stand.
 */
export const findHandoff = (
  thread: readonly IssueComment[],
  agentLogin: string,
  planRevision: number,
): string | null => {
  const handoff = findArtifact(thread, agentLogin, HANDOFF_MARKER)
  if (handoff === null) return null

  return handoff.revision === planRevision ? handoff.text : null
}
