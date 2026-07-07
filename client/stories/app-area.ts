// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type AppArea = 'settings' | 'admin' | 'debug' | 'transcript'

/**
 * Resolve a Storybook story's app area from its title's first segment.
 * Returns null for `shared/*` and any unmapped prefix (those get base+tokens only).
 */
export function appAreaFor(title: string): AppArea | null {
  const first = title.split('/')[0]
  if (first === 'settings' || first === 'admin' || first === 'debug' || first === 'transcript') {
    return first
  }
  return null
}
