// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type MessageSegment = { messageId: string; text: string; username: string | null }

/**
 * Format a single message segment for inclusion in a coalesced user turn.
 * Reproduces the queue's `collectMessageContent` rule exactly: thread context
 * with a known username gets an `[@username]: ` prefix; everything else is the
 * raw text. Factored out so edit-reconstruction can re-derive the same string
 * the queue originally built.
 */
export function formatMessageSegment(text: string, username: string | null, isThread: boolean): string {
  if (isThread && username !== null) return `[@${username}]: ${text}`
  return text
}

/**
 * Rebuild the coalesced text of a user turn from its per-message segments.
 * Join rule mirrors the queue's `flush`: DM = `\n\n`, otherwise `\n`.
 */
export function rebuildCoalescedText(
  segments: readonly MessageSegment[],
  opts: { isThread: boolean; isDm: boolean },
): string {
  const formatted = segments.map((s) => formatMessageSegment(s.text, s.username, opts.isThread))
  return opts.isDm ? formatted.join('\n\n') : formatted.join('\n')
}
