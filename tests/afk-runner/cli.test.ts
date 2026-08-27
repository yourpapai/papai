// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import path from 'node:path'

import { runCli } from '../../afk-runner/src/cli.js'

const FIXTURE_RUN = path.join(import.meta.dir, 'fixtures', 'real', '2026-08-21T19-44-19-770Z-2f6e644a')

describe('afk-runner cli', () => {
  it('prints a folded state summary with mapped/tolerated accounting for a run dir', () => {
    const summary = runCli([FIXTURE_RUN])
    expect(summary).toContain('value: completed')
    expect(summary).toContain('intake: done')
    expect(summary).toContain('gate: done')
    expect(summary).toContain('events: 886 (mapped 20, tolerated 866)')
  })

  it('exits with a usage error when no run dir is given', () => {
    expect(() => runCli([])).toThrow('usage: afk-runner <runDir>')
  })

  it('exits with a clear error for a run dir without events.ndjson', () => {
    expect(() => runCli([import.meta.dir])).toThrow('events.ndjson not found')
  })
})
