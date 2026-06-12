// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Middle-truncate a long identifier: keep `head` leading and `tail` trailing chars, join with an ellipsis. */
export function truncateMiddle(value: string, head = 8, tail = 8): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`
}
