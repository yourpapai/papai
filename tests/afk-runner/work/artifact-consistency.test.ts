// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { consistencyFindings } from '../../../afk-runner/src/work/artifact-consistency.js'
import type { ArtifactFile } from '../../../afk-runner/src/work/artifact-consistency.js'

function files(...entries: readonly [string, string][]): ArtifactFile[] {
  return entries.map(([path, content]) => ({ path, content }))
}

describe('consistencyFindings — the seeded-term scan (loop-memory D7)', () => {
  it('a migration-strategy disagreement across artifacts yields one synthesized MATERIAL finding naming both renderings', () => {
    const findings = consistencyFindings(
      files(
        ['proposal.md', '## What\nMigrations use drizzle kit for every schema change.\n'],
        ['design.md', '## Context\nThe migration path is hand-written SQL, reviewed line by line.\n'],
      ),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ id: 'C1', class: 'MATERIAL' })
    expect(findings[0]?.gap).toContain('migration strategy')
    expect(findings[0]?.gap).toContain('proposal.md')
    expect(findings[0]?.gap).toContain('design.md')
    expect(findings[0]?.gap).toContain('drizzle')
    expect(findings[0]?.gap).toContain('hand-written')
  })

  it('a recompute-interval mismatch across artifacts becomes a finding', () => {
    const findings = consistencyFindings(
      files(
        ['design.md', 'The reconciler runs every 5 * 60 * 1000 ms.\n'],
        ['specs/thing/spec.md', 'The reconciler SHALL run every 15 * 60 * 1000 ms.\n'],
      ),
    )
    expect(findings.length).toBeGreaterThanOrEqual(1)
    const interval = findings.find((finding) => finding.gap.includes('recompute interval'))
    expect(interval).toBeDefined()
    expect(interval?.gap).toContain('5 * 60 * 1000')
    expect(interval?.gap).toContain('15 * 60 * 1000')
  })

  it('a backticked identifier spelled differently across artifacts becomes a finding', () => {
    const findings = consistencyFindings(
      files(
        ['proposal.md', 'Rows land in the `llm_usage_events` table.\n'],
        ['design.md', 'Rows land in the `llmUsageEvents` table.\n'],
      ),
    )
    const naming = findings.find((finding) => finding.gap.includes('table/column naming'))
    expect(naming).toBeDefined()
    expect(naming?.gap).toContain('llm_usage_events')
    expect(naming?.gap).toContain('llmUsageEvents')
  })

  it('agreement yields none — and single-file renders never disagree', () => {
    expect(
      consistencyFindings(
        files(
          ['proposal.md', 'Migrations use drizzle kit.\n'],
          ['design.md', 'Migrations use drizzle kit here too.\n'],
        ),
      ),
    ).toEqual([])
    expect(consistencyFindings(files(['design.md', 'An interval of 5 * 60 * 1000 ms stands alone.\n']))).toEqual([])
  })
})
