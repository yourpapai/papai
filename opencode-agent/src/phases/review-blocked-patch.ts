// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { BlockedPath } from './review-push.js'

// One comment carries the whole report, so the reverted patches it embeds are
// bounded: per path, and in total across paths — a bound beyond the last whole
// patch, with the rest named in a note instead.
const PATCH_BOUND_PER_PATH = 4000
const PATCH_BOUND_TOTAL = 12_000

/**
 * The patches the guard took back out, as fenced diff blocks a maintainer can
 * apply by hand. A patch longer than the per-path bound is cut with a recovery
 * reference instead of silently shortened — the branch still carries the
 * commits the guard reverted, so `git log -p -- <path>` always recovers the
 * whole.
 */
export const renderRevertedPatches = (blocked: readonly BlockedPath[]): string[] => {
  const lines: string[] = []
  let total = 0
  for (const { path, diff } of blocked) {
    if (diff === null || diff.trim() === '') continue
    if (total >= PATCH_BOUND_TOTAL) {
      lines.push(
        '',
        `- Further reverted patches omitted to bound this report; see \`git log -p -- ${path}\` and the paths above.`,
      )
      break
    }
    const bounded =
      diff.length > PATCH_BOUND_PER_PATH
        ? `${diff.slice(0, PATCH_BOUND_PER_PATH)}… truncated — recover the full patch from the branch history: \`git log -p -- ${path}\``
        : diff
    total += bounded.length
    lines.push('', '```diff', bounded, '```')
  }
  return lines
}
