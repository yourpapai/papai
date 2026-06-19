// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Pin the signed-in operator's own session to the front so "what's happening
 * with me right now" is the first thing surfaced, without disturbing the
 * relative order of the remaining sessions.
 */
export function pinOperatorFirst<T>(
  entries: ReadonlyArray<[string, T]>,
  operatorUserId: string | undefined,
): Array<[string, T]> {
  if (operatorUserId === undefined) return [...entries]
  const operator = entries.filter(([userId]) => userId === operatorUserId)
  if (operator.length === 0) return [...entries]
  const rest = entries.filter(([userId]) => userId !== operatorUserId)
  return [...operator, ...rest]
}
