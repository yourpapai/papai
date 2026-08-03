// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { buildCoverageArgs, classifyTestLane } from '../../../scripts/mutation/coverage-runner.js'

describe('classifyTestLane — per-lane runnability and preset selection', () => {
  // bunfig.toml [test] pathIgnorePatterns excludes tests/e2e|client|visual|stories from
  // discovery. tests/client/** runs with the `test:client` preset; tests/e2e/** needs Docker
  // and tests/stories/** the sandboxed story runner, so neither can be spawned per-file.
  const cases = [
    ['tests/client/settings/scrollspy.test.ts', 'client'],
    ['/abs/proj/tests/client/settings/scrollspy.test.ts', 'client'],
    ['tests/e2e/task-lifecycle.test.ts', 'external'],
    ['/abs/proj/tests/e2e/task-lifecycle.test.ts', 'external'],
    ['tests/stories/settings/identity.story.test.ts', 'external'],
    ['tests/analytics/privacy-contract.test.ts', 'server'],
    ['tests/client-stuff/not-client.test.ts', 'server'],
    ['tests/chat/mattermost/file-helpers.test.ts', 'server'],
  ] as const
  for (const [input, expected] of cases) {
    it(`classifies ${input} as ${expected}`, () => {
      expect(classifyTestLane(input)).toBe(expected)
    })
  }
})

describe('buildCoverageArgs — bun argv per lane', () => {
  it('server lane keeps the bare invocation (bunfig discovery already includes it)', () => {
    expect(buildCoverageArgs('tests/analytics/foo.test.ts')).toEqual([
      'test',
      'tests/analytics/foo.test.ts',
      '--coverage',
      '--coverage-reporter=lcov',
    ])
  })

  it('client lane mirrors the test:client preset and clears pathIgnorePatterns', () => {
    // Mirrors package.json `test:client`: without --path-ignore-patterns '' bun's scanner
    // drops tests/client/** and reports "filters did not match any test files".
    expect(buildCoverageArgs('tests/client/settings/scrollspy.test.ts')).toEqual([
      '--conditions=browser',
      'test',
      '--preload',
      './tests/client-setup.ts',
      '--path-ignore-patterns',
      '',
      'tests/client/settings/scrollspy.test.ts',
      '--coverage',
      '--coverage-reporter=lcov',
    ])
  })
})
