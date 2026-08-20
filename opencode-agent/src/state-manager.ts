// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { locateLatestBlock, readBlock, renderBlock } from './blocks.js'
import type { IssueComment } from './blocks.js'
import { agentStateSchema, STATE_VERSION } from './types.js'
import type { AgentState } from './types.js'

export type { IssueComment } from './blocks.js'

/**
 * The state **channel**: how a phase and its counters travel between two ephemeral
 * jobs, as a hidden block on a comment.
 *
 * The machine that decides which moves are legal lives next door in
 * `transitions.ts`. The two were one file and are two questions: this one is about
 * a block surviving a hostile comment body and a scan finding the right one, that
 * one about what a signal does to the state. Splitting them is what took this file
 * back under `max-lines` when a wall-clock park arrived, along the seam the file
 * had already been describing in two separate voices.
 */

/** Marker opening every persisted state block. Also the grep handle for humans. */
export const STATE_MARKER = 'AGENT_STATE'

/** Fresh state for an issue the agent has not seen before. */
export const initialState = (issueId: number): AgentState =>
  agentStateSchema.parse({ v: STATE_VERSION, phase: 'INIT_OR_CLARIFY', issueId })

/** Renders the hidden block that carries state across ephemeral CI jobs. */
export const serializeState = (state: AgentState): string => renderBlock(STATE_MARKER, state)

/** Appends the hidden state block to a human-readable comment body. */
export const renderStateComment = (body: string, state: AgentState): string =>
  `${body.trimEnd()}\n\n${serializeState(state)}`

const toState = (candidate: unknown): AgentState | null => {
  if (candidate === undefined) return null
  const result = agentStateSchema.safeParse(candidate)
  return result.success ? result.data : null
}

/** Reads the state block out of a single comment body; `null` when absent or invalid. */
export const extractState = (commentBody: string): AgentState | null => toState(readBlock(commentBody, STATE_MARKER))

/**
 * Restores state from an issue thread: the newest comment authored by the agent
 * that carries a schema-valid state block **for this issue**.
 *
 * Two rejections, and the scan genuinely keeps walking back through both — it
 * used to take the newest readable block and validate afterwards, so a single
 * corrupt one reset a conversation that had a perfectly good block behind it.
 *
 * The `issueId` check is the security half. Anyone who can edit the agent's
 * comments can edit this block, and `issueId` is the field the rest of the
 * pipeline treats as authoritative: it names the branch through
 * `branchNameFor`, the commit trailers, and the `Closes #n` the pull request
 * carries. The event already knows which issue this is, so a block claiming a
 * different one is discarded rather than believed.
 *
 * A block from an older, incompatible `STATE_VERSION` is rejected the same way,
 * which does mean a breaking bump strands in-flight issues; see the migration
 * note in the README before bumping.
 */
export const findLatestState = (
  comments: readonly IssueComment[],
  agentLogin: string,
  issueId: number,
): AgentState | null => {
  const found = findLatestStateComment(comments, agentLogin, issueId)
  return found === null ? null : found.state
}

/** The restored state, together with the comment it was restored from. */
export interface StateComment {
  comment: IssueComment
  state: AgentState
}

/**
 * The same scan as {@link findLatestState}, keeping the comment it selected.
 *
 * `state-persist.ts` rewrites that comment's block in place instead of posting a
 * new one. Both functions come off one scan on purpose: the target of a rewrite
 * has to be the comment the *reader* will look at next, and two independent
 * scans agreeing is a coincidence rather than a property.
 */
export const findLatestStateComment = (
  comments: readonly IssueComment[],
  agentLogin: string,
  issueId: number,
): StateComment | null => {
  const found = locateLatestBlock(comments, agentLogin, STATE_MARKER, ownedBy(issueId))
  if (found === null) return null

  const state = toState(found.block)
  // `ownedBy` already parsed it, so this cannot be null; narrowing rather than
  // asserting keeps that true if the acceptance predicate ever loosens.
  return state === null ? null : { comment: found.comment, state }
}

const ownedBy =
  (issueId: number) =>
  (candidate: unknown): boolean => {
    const parsed = agentStateSchema.safeParse(candidate)
    return parsed.success && parsed.data.issueId === issueId
  }
