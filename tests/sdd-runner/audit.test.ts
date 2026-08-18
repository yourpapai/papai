// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildAuditReport } from '../../sdd-runner/src/audit.js'
import { appendEvent } from '../../sdd-runner/src/events.js'
import { createRunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-audit-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

async function seedRun(
  events: readonly import('../../sdd-runner/src/events.js').EventInput[],
  status: 'running' | 'completed' = 'completed',
): Promise<{ workDir: string; runId: string }> {
  const workDir = path.join(makeDir(), '.sdd-runner')
  const state = await createRunState({ workDir, repoRoot: workDir, changeName: 'thing' })
  const logPath = path.join(state.runDir, 'events.ndjson')
  fs.writeFileSync(logPath, '')
  for (const event of events) appendEvent(logPath, event)
  if (status !== 'running') {
    fs.writeFileSync(state.statePath, fs.readFileSync(state.statePath, 'utf8').replace('"running"', `"${status}"`))
  }
  return { workDir, runId: state.runId }
}

describe('buildAuditReport', () => {
  it('lists real decisions with rule, evidence, and a runnable overturn command', async () => {
    const { workDir, runId } = await seedRun([
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 },
      { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1 },
      {
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'R1',
        decision: 'approve',
        evidenceDigest: 'abc',
        gateVersion: 1,
      },
    ])
    const report = await buildAuditReport(workDir, runId)
    expect(report).toContain('rule R1')
    expect(report).toContain('abc')
    expect(report).toContain(
      `sdd-runner gate reopen ${runId} --gate 1 && sdd-runner gate resume ${runId} --confirm-all --veto <id>=<redirect>`,
    )
    expect(report).toContain(`(or --abort)`)
  })

  it('excludes preview, gate, and none records — an observe run yields no reconsider entries', async () => {
    const { workDir, runId } = await seedRun([
      {
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'R1',
        decision: 'preview',
        evidenceDigest: 'd',
        gateVersion: 1,
      },
      {
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'none',
        decision: 'gate',
        evidenceDigest: 'd',
        gateVersion: 1,
      },
    ])
    const report = await buildAuditReport(workDir, runId)
    expect(report).toContain('no auto-decisions to reconsider')
  })

  it('reports the policy-debt ledger with (rule, hash) dedupe and counts, read-only', async () => {
    const { workDir, runId } = await seedRun([])
    const entries = [
      { ts: '1', runId, gateVersion: 1, rule: 'none', evidenceDigest: 'x' },
      { ts: '2', runId, gateVersion: 2, rule: 'none', evidenceDigest: 'x' },
      { ts: '3', runId, gateVersion: 3, rule: 'R2', evidenceDigest: 'y' },
    ]
    fs.writeFileSync(path.join(workDir, 'policy-debt.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n'))
    const report = await buildAuditReport(workDir, runId)
    expect(report).toMatch(/policy debt R2 × 1/u)
    const line = report.split('\n').find((l) => l.includes('none'))
    expect(line).toBeDefined()
    expect(line?.includes('2')).toBe(true)
  })
})
