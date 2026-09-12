// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  renderCommandElsewhere,
  renderFollowUpUsage,
  renderRefusedCommand,
} from '../../opencode-agent/src/run-report.js'

/**
 * The command-refusal renderers, in their own right.
 *
 * Their callers (`triggers.ts`, `command-refusals.ts`) exercise them through
 * the dispatch paths; this file pins the wording contracts the dispatch tests
 * only sample — most importantly the one the `/follow-up` usage note turns on:
 * a refusal must never name the refused command in its own offered list, and
 * a usage refusal must say what the command needs rather than claim the phase
 * refuses it.
 */

describe('renderRefusedCommand', () => {
  it('names the command, the phase that refuses it, and what does work', () => {
    const rendered = renderRefusedCommand('/retry', 'PLAN_REVIEW', ['/ask', '/sync'])

    expect(rendered).toContain('`/retry` does not apply right now')
    expect(rendered).toContain('I am parked in `PLAN_REVIEW`, which does not accept it')
    expect(rendered).toContain('What works here: `/ask`, `/sync`.')
  })

  it('says no command moves the issue when the accepted list is empty', () => {
    const rendered = renderRefusedCommand('/approve', 'COMPLETE', [])

    expect(rendered).toContain('No command moves this issue on from here.')
  })
})

describe('renderCommandElsewhere', () => {
  it('points at the pull request by URL and claims nothing about the state', () => {
    const rendered = renderCommandElsewhere('/retry', 'https://example.test/pull/7')

    expect(rendered).toContain('`/retry` belongs on the pull request now')
    expect(rendered).toContain("This issue's work is in https://example.test/pull/7")
    expect(rendered).toContain('Type `/retry` there instead.')
    // The "does not apply" wording would be false twice over here — the
    // command is perfectly good, one page over.
    expect(rendered).not.toContain('does not apply')
  })

  it('survives a state that somehow names no pull request', () => {
    // `commandSurface` returns `elsewhere` only when `prNumber` is set, so the
    // null branch is unreachable — but a renderer that cannot be handed a
    // broken state is one fewer thing to check.
    const rendered = renderCommandElsewhere('/review', null)

    expect(rendered).toContain('that is where I take commands from once one exists')
  })
})

describe('renderFollowUpUsage', () => {
  it('names the command and the argument it needs, and claims nothing broke', () => {
    // The size gate is a model turn; an empty argument is nothing to assess.
    // The note is the whole answer — it must not borrow the wrong-command
    // frame ("does not apply right now"), which would be false: the delivered
    // state accepts the command, the request is what is missing.
    const rendered = renderFollowUpUsage()

    expect(rendered).toContain('`/follow-up` needs an argument')
    expect(rendered).toContain('Type `/follow-up`')
    expect(rendered).toContain('what to change')
    expect(rendered).toContain('nothing has changed')
    expect(rendered).not.toContain('does not apply')
  })
})
