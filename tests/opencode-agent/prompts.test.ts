// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { TRIAGE_INSTRUCTIONS } from '../../opencode-agent/src/prompts.js'

/**
 * The triage prompt's questions reach the issue verbatim, and a suggested
 * command is a suggestion the machine may refuse: what a phase accepts derives
 * from the transition table, and the run's own comments name what works. Plain
 * replies are the one channel always routed — `INIT_OR_CLARIFY` re-runs triage
 * on them, the waiting phases classify them. Pinned like the other instruction
 * rules so a rewording cannot quietly drop the invite.
 */
describe('the triage instructions route maintainer input through the thread', () => {
  test('they invite a plain reply and never suggest a command a phase may refuse', () => {
    expect(TRIAGE_INSTRUCTIONS).toContain('plain reply on the thread')
    expect(TRIAGE_INSTRUCTIONS).toContain('never suggest a slash command')
    expect(TRIAGE_INSTRUCTIONS).toContain('may refuse')
  })
})
