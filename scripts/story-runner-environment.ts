// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function sanitizedStoryEnvironment(source: Record<string, string | undefined>): Record<string, string> {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'CI'] as const
  const env = Object.fromEntries(
    allowed.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]] as const])),
  )
  env['TZ'] = 'UTC'
  env['PAPAI_STORY_RUNNER'] = '1'
  return env
}
