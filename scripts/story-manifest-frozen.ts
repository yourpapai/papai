// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const FROZEN_TEST_SUPPORT = new Set([
  'bunfig.toml',
  'tests/mock-reset.ts',
  'tests/setup.ts',
  'tests/utils/logger-mock.ts',
  'tests/utils/test-helpers.ts',
])

export function isFrozenEnforcementPath(filePath: string): boolean {
  return (
    filePath === 'scripts/test-stories.ts' ||
    /^scripts\/story-dependency-snapshot(?:-(?:cleanup|installer|key|root|symlink|tree|workspaces))?\.ts$/u.test(
      filePath,
    ) ||
    filePath === 'scripts/story-manifest-arguments.ts' ||
    filePath === 'scripts/story-manifest-dependencies.ts' ||
    filePath === 'scripts/story-reports.ts' ||
    /^scripts\/story-sandbox(?:-linux)?\.ts$/u.test(filePath) ||
    filePath === 'scripts/test-story-sandbox.ts' ||
    /^scripts\/story-(?:manifest|runner).*\.ts$/u.test(filePath)
  )
}

export function isFrozenTestSupportPath(filePath: string): boolean {
  return FROZEN_TEST_SUPPORT.has(filePath)
}
