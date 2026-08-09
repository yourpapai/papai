// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { findLatestBlock, renderBlock } from './blocks.js'
import type { IssueComment } from './blocks.js'
import { planStepSchema } from './plan-steps.js'
import type { PlanStep } from './plan-steps.js'

/**
 * Artefacts the pipeline writes once and reads back in a later job: the design
 * spec, the plan, and the implementation report.
 *
 * Each is persisted in its own hidden block rather than recovered by matching a
 * markdown heading in the visible comment. That distinction matters: these
 * payloads are model-written markdown full of headings and `---` rules, and any
 * scraping scheme truncates them the moment the model writes one.
 */
export const SPEC_MARKER = 'AGENT_SPEC'
export const PLAN_MARKER = 'AGENT_PLAN'
export const REPORT_MARKER = 'AGENT_REPORT'
/**
 * The handoff a wall-clock stop leaves for the `/continue` that follows it: what
 * the interrupted turn finished, what remains, and what it tried that did not work.
 *
 * A block like the others rather than a heading in the notice, for the reason this
 * module exists at all — it is model-written markdown full of headings and lists,
 * and every scraping scheme truncates that the moment the model writes one. It is
 * also the artefact with the most to lose from a bad recovery: the "tried and did
 * not work" section is the one thing a fresh session cannot re-derive from the
 * diff and the plan, so a truncated read is not a cosmetic loss, it is a
 * continuation re-treading ground somebody already paid for.
 */
export const HANDOFF_MARKER = 'AGENT_HANDOFF'

const artifactSchema = z.object({
  text: z.string().min(1),
  revision: z.number().int().min(0).default(0),
})

export type Artifact = z.infer<typeof artifactSchema>

/** Renders the hidden block that carries an artefact to the next job. */
export const renderArtifact = (marker: string, text: string, revision: number): string =>
  renderBlock(marker, { text, revision })

/** Reads the newest agent-authored artefact of this kind; `null` when absent. */
export const findArtifact = (thread: readonly IssueComment[], agentLogin: string, marker: string): Artifact | null => {
  const result = artifactSchema.safeParse(findLatestBlock(thread, agentLogin, marker))
  return result.success ? result.data : null
}

/**
 * The plan block, which carries the steps beside the text.
 *
 * `steps` is `.catch([])` rather than optional-with-a-default, and the fallback is
 * the point: **absent, malformed and half-malformed all read as "no steps"**, which
 * is exactly the one-turn implementation this pipeline did before stage 3. Three
 * cases arrive here and all three want that answer — a plan approved on a live issue
 * before steps existed, a hand-edited block (this is attacker-editable text like
 * every other one), and a payload from a future shape this code does not know.
 *
 * Note what it deliberately does *not* do: recover the steps it can parse and drop
 * the rest. Half a plan read as a whole plan is the failure this module exists to
 * prevent — the truncated spec, one level along — so a list the schema cannot vouch
 * for is no list at all, and the phase falls back to the document a human approved.
 *
 * The fallback is **permanent, not a migration**. There is nothing to migrate *to*:
 * the steps are the planner's own structured output, and no amount of parsing can
 * invent them for a plan that was approved without them. Re-deriving them would mean
 * a second planning turn against a spec the maintainer has already signed off on, in
 * a phase whose job is to implement — so an old plan runs as one turn, exactly as it
 * did on the day it was approved.
 */
const planArtifactSchema = artifactSchema.extend({ steps: z.array(planStepSchema).catch([]) })

export type PlanArtifact = z.infer<typeof planArtifactSchema>

/** Renders the plan block: the text a maintainer reads and the steps it was rendered from. */
export const renderPlanArtifact = (text: string, revision: number, steps: readonly PlanStep[]): string =>
  renderBlock(PLAN_MARKER, { text, revision, steps })

/** Reads the newest plan the agent posted, steps included; `null` when there is none. */
export const findPlan = (thread: readonly IssueComment[], agentLogin: string): PlanArtifact | null => {
  const result = planArtifactSchema.safeParse(findLatestBlock(thread, agentLogin, PLAN_MARKER))
  return result.success ? result.data : null
}

/** The plan, or the caller's own failure when the issue carries none. */
export const requirePlan = (
  thread: readonly IssueComment[],
  agentLogin: string,
  onMissing: () => Error,
): PlanArtifact => {
  const plan = findPlan(thread, agentLogin)
  if (plan === null) throw onMissing()
  return plan
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

/** Reads an artefact's text, or throws via `onMissing` when it is not there. */
export const requireArtifact = (
  thread: readonly IssueComment[],
  agentLogin: string,
  marker: string,
  onMissing: () => Error,
): string => {
  const artifact = findArtifact(thread, agentLogin, marker)
  if (artifact === null) throw onMissing()
  return artifact.text
}
