// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Sequential async helpers.
 *
 * Everything in this pipeline that iterates — checks, repair rounds, skill roots
 * — must run one at a time: the steps share a working tree, and their output has
 * to stay readable in a CI log. These helpers express that ordering without a
 * loop body that awaits.
 */

/** Maps `items` one at a time, preserving order. */
export const mapSeries = <T, R>(items: readonly T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> =>
  items.reduce<Promise<R[]>>(async (pending, item, index) => {
    const done = await pending
    done.push(await fn(item, index))
    return done
  }, Promise.resolve([]))

/**
 * Returns the first non-null result, short-circuiting on success. Used where a
 * later attempt is only worth making because the earlier one came up empty.
 */
export const firstMatch = async <T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R | null>,
  index = 0,
): Promise<R | null> => {
  const item = items[index]
  if (item === undefined) return null

  const result = await fn(item)
  if (result !== null) return result
  return firstMatch(items, fn, index + 1)
}
