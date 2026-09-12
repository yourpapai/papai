// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  renderFollowUpApplied,
  renderFollowUpChecksRed,
  renderFollowUpDecline,
  renderFollowUpFailure,
  renderFollowUpOverBudget,
} from '../../opencode-agent/src/follow-up-notices.js'

/**
 * The `/follow-up` renderers, in their own right.
 *
 * `follow-up.test.ts` exercises them through the handler; this file pins the
 * wording contracts each outcome owes its reader — the decision and reason on
 * both paths, the decline's ready-to-paste draft, the checks-red report naming
 * what ran, and the rule that a decline is not a failure: the run completed,
 * because the gate saying "too big" is the command working.
 */

const PR_URL = 'https://example.test/pull/7'

describe('renderFollowUpDecline', () => {
  it('states the reason, applies nothing, and hands over a ready-to-paste draft', () => {
    const rendered = renderFollowUpDecline('This asks for a new capability, not a tweak.', PR_URL)

    expect(rendered).toContain('too big')
    expect(rendered).toContain('This asks for a new capability, not a tweak.')
    expect(rendered).toContain('Nothing was applied')
    expect(rendered).toContain('no commit, no push')
    // The draft: a title line and a description that references the PR.
    expect(rendered).toContain('Title')
    expect(rendered).toContain(PR_URL)
  })
})

describe('renderFollowUpApplied', () => {
  it('restates the verdict, names the files, the checks and the sha', () => {
    const rendered = renderFollowUpApplied({
      reason: 'A one-line constant change in a file the change already touched.',
      summary: 'Tightened the retry backoff.',
      files: ['src/http/retry.ts'],
      checks: ['bun test tests/http/retry.test.ts', 'bun check:full'],
      sha: 'head-sha',
      dropped: [],
    })

    expect(rendered).toContain('small')
    expect(rendered).toContain('A one-line constant change in a file the change already touched.')
    expect(rendered).toContain('`src/http/retry.ts`')
    expect(rendered).toContain('`bun test tests/http/retry.test.ts`')
    expect(rendered).toContain('`bun check:full`')
    expect(rendered).toContain('`head-sha`')
  })

  it('reports a protected-path drop as a maintainer-by-hand remedy', () => {
    const rendered = renderFollowUpApplied({
      reason: 'A one-line change.',
      summary: 's',
      files: ['src/a.ts', '.github/workflows/ci.yml'],
      checks: ['bun check:full'],
      sha: 'head-sha',
      dropped: ['.github/workflows/ci.yml'],
    })

    expect(rendered).toContain('`.github/workflows/ci.yml`')
    expect(rendered).toContain('by hand')
  })

  it('says no files changed when the apply turn edited nothing', () => {
    const rendered = renderFollowUpApplied({
      reason: 'A one-line change.',
      summary: 's',
      files: [],
      checks: ['bun check:full'],
      sha: 'nothing to push — no commit was made',
      dropped: [],
    })

    expect(rendered).toContain('No files changed.')
    // No drop, no drop line: the remedy must not invent work for a maintainer.
    expect(rendered).not.toContain('by hand')
  })
})

describe('renderFollowUpChecksRed', () => {
  it('names what ran, what failed, and that the branch is as found', () => {
    const rendered = renderFollowUpChecksRed(
      ['bun test tests/http/retry.test.ts', 'bun check:full'],
      [{ name: 'bun check:full', exitCode: 1, output: '1 failure' }],
      PR_URL,
    )

    expect(rendered).toContain('`bun test tests/http/retry.test.ts`')
    expect(rendered).toContain('`bun check:full`')
    expect(rendered).toContain('exit 1')
    expect(rendered).toContain('nothing was pushed')
    expect(rendered).toContain('exactly as this command found it')
  })

  it('names the remedy without a pull request when there is none to name', () => {
    const rendered = renderFollowUpChecksRed(
      ['bun check:full'],
      [{ name: 'bun check:full', exitCode: 1, output: 'x' }],
      null,
    )

    // The remedy sentence stands alone — no empty parentheses where a URL
    // would have been.
    expect(rendered).toContain('open the pull request and apply it there')
    expect(rendered).not.toContain('()')
  })
})

describe('renderFollowUpOverBudget', () => {
  it('names the ceiling, the turn it did not start, and the remedies', () => {
    const rendered = renderFollowUpOverBudget(5_000_000, 5_000_000, 'agent/issue-42', PR_URL)

    expect(rendered).toContain('AGENT_MAX_TOKENS')
    expect(rendered).toContain('5,000,000')
    expect(rendered).toContain('did not start')
    expect(rendered).toContain('/follow-up')
  })
})

describe('renderFollowUpFailure', () => {
  it('carries the message and leaves the issue where it was', () => {
    const rendered = renderFollowUpFailure('COMPLETE', 'agent/issue-42', 'git failed: remote rejected')

    expect(rendered).toContain('git failed: remote rejected')
    expect(rendered).toContain('still in `COMPLETE`')
    expect(rendered).toContain('as this command found it')
  })
})
