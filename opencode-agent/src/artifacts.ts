// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { findLatestBlock, renderBlock } from './blocks.js'
import type { IssueComment } from './blocks.js'

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
