// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Pixels of gap from the bottom still treated as "reading the live tail". */
const DEFAULT_SLACK = 64

/**
 * True when the viewport sits within `slack` pixels of the bottom of the page.
 *
 * Callers must measure BEFORE new content renders. Once an event is appended, a reader who was
 * pinned to the bottom sits one event-height above it, and a post-render measurement would read
 * that as a deliberate scroll-up and stop following.
 */
export function shouldFollow(
  scrollY: number,
  innerHeight: number,
  scrollHeight: number,
  slack: number = DEFAULT_SLACK,
): boolean {
  return scrollY + innerHeight >= scrollHeight - slack
}
