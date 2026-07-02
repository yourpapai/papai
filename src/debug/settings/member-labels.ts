// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

export type LiveLabelResolver = (userId: string) => Promise<string | null>

const LIVE_CONCURRENCY = 5

/**
 * Resolve a display label for each userId. Cache hits (from the prefetched map) win; misses
 * fall back to a bounded set of live resolver calls. A live call that rejects yields null for
 * that id — resolution is best-effort and never throws.
 */
export async function resolveMemberLabels(
  userIds: readonly string[],
  cached: ReadonlyMap<string, string>,
  resolveLive: LiveLabelResolver,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  const misses: string[] = []
  for (const id of userIds) {
    const hit = cached.get(id)
    if (hit === undefined) misses.push(id)
    else result.set(id, hit)
  }
  const limit = pLimit(LIVE_CONCURRENCY)
  await Promise.all(
    misses.map((id) =>
      limit(async () => {
        try {
          result.set(id, await resolveLive(id))
        } catch {
          result.set(id, null)
        }
      }),
    ),
  )
  return result
}
