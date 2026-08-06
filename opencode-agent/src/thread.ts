// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IssueComment } from './state-manager.js'

/** Headings the agent uses so later phases can find their own earlier output. */
export const SPEC_HEADING = '### Design spec'
export const PLAN_HEADING = '### Execution plan'

const STATE_BLOCK_PATTERN = /<!--\s*AGENT_STATE:[\S\s]*?-->/gu
const TRAILER_PATTERN = /\n---\n[\S\s]*$/u

/**
 * Finds the newest agent comment carrying `heading` and returns its body with
 * the heading, the hidden state block and the trailing call-to-action stripped —
 * i.e. just the content a later phase needs to act on.
 *
 * Comments are the only durable channel between ephemeral jobs, so the spec and
 * plan are recovered from the thread rather than re-derived by the model.
 */
export const findAgentSection = (
  thread: readonly IssueComment[],
  agentLogin: string,
  heading: string,
): string | null => {
  const normalizedAgent = agentLogin.toLowerCase()

  for (let index = thread.length - 1; index >= 0; index -= 1) {
    const comment = thread[index]
    if (comment === undefined) continue
    if (comment.authorLogin.toLowerCase() !== normalizedAgent) continue

    const headingAt = comment.body.indexOf(heading)
    if (headingAt === -1) continue

    const section = stripDecorations(comment.body.slice(headingAt + heading.length))
    if (section.length > 0) return section
  }

  return null
}

const stripDecorations = (body: string): string =>
  body.replace(STATE_BLOCK_PATTERN, '').replace(TRAILER_PATTERN, '').trim()
