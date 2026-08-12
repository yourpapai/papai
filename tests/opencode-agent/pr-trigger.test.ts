// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { evaluateGuardrails } from '../../opencode-agent/src/guardrails.js'
import { parseTriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { PrMergedTriggerEvent } from '../../opencode-agent/src/trigger-events.js'

/**
 * Design D7 — the archive door.
 *
 * `pull_request.closed(merged)` on a branch the agent owns is the propose →
 * apply → archive loop's closing half: the ARCHIVE phase runs `openspec
 * archive` as a follow-up commit on master. These tests pin the door's three
 * legs — parse, guardrails (foreign-repo refusal), and issue resolution via the
 * head branch — following the existing `ci-trigger.ts` door pattern rather than
 * the comment-on-PR one (no API call: the payload carries the head branch).
 */

const merged = (over: Record<string, unknown> = {}): unknown => ({
  action: 'closed',
  pull_request: {
    merged: true,
    number: 7,
    head: { ref: 'agent/issue-42', repo: { full_name: 'acme/widgets' } },
    base: { ref: 'main' },
  },
  repository: { full_name: 'acme/widgets', default_branch: 'main' },
  sender: { login: 'maintainer', type: 'User' },
  ...over,
})

describe('parseTriggerEvent · pull_request.closed(merged) (D7)', () => {
  it('parses a merged agent-branch PR into a pr-merged event resolved via the head branch', () => {
    const event = parseTriggerEvent('pull_request', merged())
    expect(event).toMatchObject({
      kind: 'pr-merged',
      issueNumber: 42,
      prNumber: 7,
      baseBranch: 'main',
    })
  })

  it('returns null for a close that was not a merge', () => {
    const event = parseTriggerEvent(
      'pull_request',
      merged({ pull_request: { merged: false, number: 7, head: { ref: 'agent/issue-42' }, base: { ref: 'main' } } }),
    )

    expect(event).toBeNull()
  })

  it('returns null for a merged PR on a branch the agent does not own', () => {
    const event = parseTriggerEvent(
      'pull_request',
      merged({ pull_request: { merged: true, number: 7, head: { ref: 'feature/x' }, base: { ref: 'main' } } }),
    )

    expect(event).toBeNull()
  })

  it('returns null for a non-closed action', () => {
    const event = parseTriggerEvent(
      'pull_request',
      merged({
        action: 'opened',
        pull_request: { merged: false, number: 7, head: { ref: 'agent/issue-42' }, base: { ref: 'main' } },
      }),
    )

    expect(event).toBeNull()
  })
})

describe('evaluateGuardrails · pr-merged foreign-repo refusal (D7)', () => {
  const options = { selfLogin: 'agent-bot', selfWorkflowName: 'OpenCode Issue Agent' }

  const prMerged = (fromThisRepository: boolean): PrMergedTriggerEvent => ({
    kind: 'pr-merged',
    eventName: 'pull_request',
    prNumber: 7,
    issueNumber: 42,
    baseBranch: 'main',
    fromThisRepository,
    defaultBranch: 'main',
  })

  it('allows a merged PR whose head is this repository', () => {
    const decision = evaluateGuardrails(prMerged(true), options)
    expect(decision.allowed).toBe(true)
  })

  it('refuses a merged PR merged from a fork (foreign repository)', () => {
    const decision = evaluateGuardrails(prMerged(false), options)
    expect(decision.allowed).toBe(false)
    expect(decision).toMatchObject({ code: 'PR_FOREIGN_REPOSITORY' })
  })
})
