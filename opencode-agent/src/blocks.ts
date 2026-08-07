// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The durable channel between ephemeral CI jobs: hidden HTML comment blocks on
 * the issue thread.
 *
 * Everything the pipeline must remember — phase, spec, plan, report — travels
 * as a JSON payload inside `<!-- MARKER: {...} -->`. Reading it back is exact:
 * no heading matching, no trailer stripping, no prose parsing. That matters
 * because the payloads are model-written markdown that routinely contains
 * headings and `---` rules of its own.
 */

/** A comment as the block layer needs to see it, independent of the API shape. */
export interface IssueComment {
  id: number
  body: string
  authorLogin: string
}

const MARKER_PATTERN = /^[A-Z][\dA-Z_]*$/u

const escapeMarker = (marker: string): string => {
  if (!MARKER_PATTERN.test(marker)) throw new Error(`Invalid block marker: ${marker}`)
  return marker
}

/**
 * Serializes a payload so it cannot terminate its own block.
 *
 * `JSON.stringify` escapes quotes and backslashes but not `-->`, and the block
 * pattern is non-greedy, so a payload containing `-->` ends the block early and
 * the remainder fails to parse. That is not hypothetical: mermaid diagrams
 * (`A --> B`) belong in a design spec, and plenty of compilers print `-->` in
 * the diagnostics that land in `lastError`.
 *
 * Escaping every `<` and `>` as a JSON unicode escape closes it at the source.
 * Both characters can only occur inside string literals — JSON's structural
 * syntax has neither — so a blanket replacement on the serialized form is safe,
 * and `JSON.parse` decodes the escapes back to the original text exactly.
 *
 * The cost is that HTML-ish payload text reads as `<…>` in the raw
 * comment. These blocks are machine state; the human-readable rendering lives
 * in the visible markdown above them.
 */
const encodePayload = (payload: unknown): string =>
  JSON.stringify(payload, null, 2).replaceAll('<', '\\u003C').replaceAll('>', '\\u003E')

/** Renders a hidden block. Markers are `SCREAMING_SNAKE` and validated. */
export const renderBlock = (marker: string, payload: unknown): string =>
  `<!-- ${escapeMarker(marker)}:\n${encodePayload(payload)}\n-->`

const blockPattern = (marker: string): RegExp => new RegExp(`<!--\\s*${escapeMarker(marker)}:\\s*([\\S\\s]*?)-->`, 'gu')

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Reads the last block with this marker from one comment body.
 *
 * Last rather than first: a body carries the agent's own markdown above its
 * blocks, and the pipeline appends blocks in order, so the final one is the
 * most recent write. `undefined` means absent or unparsable — never a throw,
 * so a single corrupt comment cannot wedge the pipeline.
 */
export const readBlock = (body: string, marker: string): unknown => {
  let found: unknown

  for (const match of body.matchAll(blockPattern(marker))) {
    const raw = match[1]
    if (raw === undefined) continue

    const parsed = parseJson(raw)
    if (parsed !== undefined) found = parsed
  }

  return found
}

/**
 * Walks the thread newest-first and returns the first block written by the
 * agent itself. Author filtering is the whole security model here: anyone can
 * paste a block into a comment, but only the agent's own comments are read.
 */
export const findLatestBlock = (thread: readonly IssueComment[], agentLogin: string, marker: string): unknown => {
  const normalizedAgent = agentLogin.toLowerCase()

  for (let index = thread.length - 1; index >= 0; index -= 1) {
    const comment = thread[index]
    if (comment === undefined) continue
    if (comment.authorLogin.toLowerCase() !== normalizedAgent) continue

    const block = readBlock(comment.body, marker)
    if (block !== undefined) return block
  }

  return undefined
}

/** Strips every hidden block from a body — used before showing it to the model. */
export const stripBlocks = (body: string): string => body.replace(/<!--\s*[A-Z][\dA-Z_]*:\s*[\S\s]*?-->/gu, '').trim()
