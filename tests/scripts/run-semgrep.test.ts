// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('run-semgrep script', () => {
  test('disables git-aware filtering so Docker scans worktree files', async () => {
    const source = await Bun.file('scripts/run-semgrep.ts').text()

    expect(source).toContain("'--no-git-ignore'")
  })

  test('excludes generated dashboard output from security scans', async () => {
    const source = await Bun.file('scripts/run-semgrep.ts').text()

    expect(source).toContain("'public'")
  })
})
