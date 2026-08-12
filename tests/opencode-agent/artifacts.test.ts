// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { renderDigest } from '../../opencode-agent/src/artifacts.js'

/**
 * Design D1 — the folder is truth; comments are renders.
 *
 * `renderDigest` is the one renderer for the two human parks (`DESIGN_SPEC`,
 * `PLAN_REVIEW`): it frames the artifact content read from the folder with the
 * branch as the history of record, and (for the plan) the revision token the
 * machine uses to tell two plans apart. It does not carry the artifact itself —
 * the folder's commits are the real history, and a rendered snapshot that
 * pretended to be the artifact would be two truths, exactly the drift design
 * D1 retired.
 */

describe('renderDigest · folder-is-truth framing (D1)', () => {
  it('renders the artifact content and names the branch as the history of record', () => {
    const digest = renderDigest('# Goal\n\nAdd a retry helper.', {
      changeName: 'add-retry-helper',
      branch: 'agent/issue-42',
      revision: null,
    })

    // The content reaches the reader.
    expect(digest).toContain('# Goal')
    expect(digest).toContain('Add a retry helper.')
    // The folder is named as the source of truth, with the branch its history.
    expect(digest).toContain('openspec/changes/add-retry-helper/')
    expect(digest).toContain('agent/issue-42')
  })

  it('stamps the plan revision token when the park tracks one (PLAN_REVIEW)', () => {
    const digest = renderDigest('- [ ] Step one\n', {
      changeName: 'add-retry-helper',
      branch: 'agent/issue-42',
      revision: 3,
    })

    // Revision display metadata (D1: "revision counters become display metadata
    // on rendered digests"). The counter is a machine identity, not the
    // artifact's history — the branch's commits are — and the digest says so.
    expect(digest).toContain('3')
  })

  it('omits the revision stamp at DESIGN_SPEC (the proposal has no counter)', () => {
    const digest = renderDigest('# Goal\n\nAdd retries.', {
      changeName: 'add-retry-helper',
      branch: 'agent/issue-42',
      revision: null,
    })

    // No plan-revision label: the proposal's history is the branch's commits
    // alone, and stamping a counter that does not exist would be a second
    // truth the folder does not carry.
    expect(digest).not.toContain('plan revision')
    expect(digest).not.toContain('revision 0')
  })

  it('trims surrounding blank lines from the folder content but preserves inner structure', () => {
    const digest = renderDigest('\n\n# Goal\n\n- a\n- b\n\n\n', {
      changeName: 'add-x',
      branch: 'agent/issue-1',
      revision: null,
    })

    expect(digest).toContain('# Goal\n\n- a\n- b')
  })
})
