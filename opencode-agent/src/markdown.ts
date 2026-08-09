// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const MIN_FENCE = 3

const longestBacktickRun = (content: string): number => {
  let longest = 0
  for (const match of content.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length)
  return longest
}

/**
 * Wraps content in a code fence long enough that the content cannot close it.
 *
 * Everything this pipeline fences is written by something else — a model reply,
 * a check's stdout, a review-loop summary — and all three routinely contain
 * fences of their own. A fixed ```` ``` ```` lets the first inner fence close the
 * block early, at which point the trailing prose renders as code and the code
 * renders as prose. The failure comment is the worst place for that: its last
 * line is the instruction telling the maintainer how to recover, and it is the
 * part that ends up swallowed.
 *
 * CommonMark closes a fence only with a run of at least as many backticks, so
 * one longer than anything inside is always safe.
 */
export const fence = (content: string, info = ''): string => {
  const ticks = '`'.repeat(Math.max(MIN_FENCE, longestBacktickRun(content) + 1))
  return `${ticks}${info}\n${content}\n${ticks}`
}
