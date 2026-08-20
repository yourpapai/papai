// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { buildDriftPrompt } from '../../sdd-runner/src/drift.js'

describe('buildDriftPrompt', () => {
  it('names the edited files and the report write target', () => {
    const prompt = buildDriftPrompt(['specs/thing/spec.md', 'design.md'], '/abs/tasks.md', '/abs')
    expect(prompt).toContain('specs/thing/spec.md')
    expect(prompt).toContain('design.md')
    expect(prompt).toContain('/abs/tasks.md')
    expect(prompt).toContain('.review-loop/drift.json')
  })
})
