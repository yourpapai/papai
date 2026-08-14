// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { DEFAULT_CHECKS, parseChecks } from '../../opencode-agent/src/check-spec.js'

/**
 * What the CI-fix loop reproduces has to be what CI actually ran.
 *
 * The defaults are the whole contract for a repository that declares no
 * `AGENT_CHECKS`, and a default that diverges from the repository's own runner
 * is worse than no reproduction at all: the loop then repairs failures CI does
 * not have. Run 31779566286 is that, end to end — the `test` check went red on
 * the agent's runner for a reason CI never sees, the agent diagnosed it as a
 * workflow defect, wrote a fix to `.github/workflows/agent-pipeline.yml`, had it
 * dropped at staging, and reported "nothing changed" three times until the pull
 * request's `ciAttempts` budget was gone. The one genuinely failing test on that
 * branch — 1 of 14,049 — was never looked at.
 */
describe('the checks a repository gets when it declares none', () => {
  const argvFor = (name: string): readonly string[] => DEFAULT_CHECKS.find((check) => check.name === name)?.argv ?? []

  test('runs the suite through the wrapper, never bare `bun test`', () => {
    // Four things `scripts/test/run-cli.ts` does that a bare `bun test` does
    // not, and every one of them is a way the loop's verdict diverged from CI's:
    // it builds the gitignored `public/` bundles `tests/debug/` needs, picks
    // serial when `CI` is set (bare `--parallel` OOMs a 4-vCPU runner), applies
    // the per-test `--timeout` bun ignores from `bunfig.toml`, and leaves a
    // queryable report behind.
    expect(argvFor('test')).toEqual(['bun', 'run', 'test'])
  })

  test('the other two are already the commands a contributor runs', () => {
    expect(argvFor('lint')).toEqual(['bun', 'run', 'lint'])
    expect(argvFor('typecheck')).toEqual(['bun', 'run', 'typecheck'])
  })

  test('an unset AGENT_CHECKS falls back to exactly those', () => {
    expect(parseChecks(undefined)).toEqual(DEFAULT_CHECKS)
    expect(parseChecks('   ')).toEqual(DEFAULT_CHECKS)
  })

  test('a repository that declares its own is taken at its word', () => {
    // The defaults are a fallback, not a policy: a repository whose suite is
    // spelled differently must be able to say so, and this is the seam that
    // lets the fix above be a default rather than a hardcoding.
    expect(parseChecks('[{"name":"suite","argv":["make","check"]}]')).toEqual([
      { name: 'suite', argv: ['make', 'check'] },
    ])
  })
})
