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

/** A block, and the comment it was read out of. */
export interface BlockLocation {
  comment: IssueComment
  block: unknown
}

/**
 * Walks the thread newest-first and returns the first block written by the
 * agent itself, **with the comment carrying it**. Author filtering is the whole
 * security model here: anyone can paste a block into a comment, but only the
 * agent's own comments are read.
 *
 * The comment is returned rather than only the payload because rewriting a
 * block in place has to address the comment the *reader* selected. Two scans —
 * one to read the state and another to find something to rewrite — can disagree
 * whenever the thread has more than one candidate, and rewriting the wrong
 * comment is the failure mode of an in-place update. One scan, and every caller
 * derived from it, makes them agree by construction.
 */
export const locateLatestBlock = (
  thread: readonly IssueComment[],
  agentLogin: string,
  marker: string,
  accept: (block: unknown) => boolean = (): boolean => true,
): BlockLocation | null => {
  const normalizedAgent = agentLogin.toLowerCase()

  for (let index = thread.length - 1; index >= 0; index -= 1) {
    const comment = thread[index]
    if (comment === undefined) continue
    if (comment.authorLogin.toLowerCase() !== normalizedAgent) continue

    const block = readBlock(comment.body, marker)
    // A block the caller rejects is walked past, not surrendered to. Returning
    // the newest *readable* block and letting the caller validate afterwards
    // meant one corrupt or foreign block masked every good one behind it.
    if (block !== undefined && accept(block)) return { comment, block }
  }

  return null
}

/** The payload half of {@link locateLatestBlock}, for callers with no comment to rewrite. */
export const findLatestBlock = (
  thread: readonly IssueComment[],
  agentLogin: string,
  marker: string,
  accept: (block: unknown) => boolean = (): boolean => true,
): unknown => {
  const found = locateLatestBlock(thread, agentLogin, marker, accept)
  return found === null ? undefined : found.block
}

/**
 * Rewrites a body's block with a new payload, or `null` when it carries none.
 *
 * Through {@link renderBlock} rather than by patching the JSON inside the
 * delimiters, and that is the whole point of the function existing at all:
 * `renderBlock` escapes every `<` and `>` so a payload cannot forge its own
 * terminator, which a mermaid diagram (`A --> B`) and half the compiler
 * diagnostics that land in `lastError` routinely would. An in-place rewrite that
 * assembled the block itself would reintroduce that bug on a new surface, where
 * the original test suite is not looking.
 *
 * The **last** block with this marker is the one replaced, because that is the
 * one {@link readBlock} reads back. Rewriting an earlier one would leave the
 * body parsing to whatever it said before.
 */
export const replaceBlock = (body: string, marker: string, payload: unknown): string | null => {
  const last = [...body.matchAll(blockPattern(marker))].at(-1)
  if (last === undefined || last.index === undefined) return null

  return `${body.slice(0, last.index)}${renderBlock(marker, payload)}${body.slice(last.index + last[0].length)}`
}

/**
 * Strips every hidden block from a body — used before showing it to the model.
 *
 * `[<]` rather than a plain `<`, which is the same character class of one and
 * changes nothing at run time. Semgrep's TypeScript parser reads the literal
 * `<!--` as the Annex B HTML-like comment opener even inside a regex literal,
 * fails to parse the rest of the line, and `--strict` turns that into a failed
 * security scan with no finding to explain it. Isolated to the three characters:
 * a regex containing `/<!--` fails to parse, the same regex without it parses,
 * and this form parses. Every other `<!--` in this file is inside a string,
 * which the parser handles.
 */
export const stripBlocks = (body: string): string => body.replace(/[<]!--\s*[A-Z][\dA-Z_]*:\s*[\S\s]*?-->/gu, '').trim()
