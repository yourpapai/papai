// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { readEvents } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { startRun } from '../../../afk-runner/src/run.js'
import { BLOCKER_ROUND, makeFakePipeline, TASK_TEXT } from '../fixtures/fake-pipeline.js'

function gateEvents(runDir: string): SddEvent[] {
  return readEvents(path.join(runDir, 'events.ndjson')).filter((event) => event.type === 'gate')
}

function presentedEvents(runDir: string): SddEvent[] {
  return gateEvents(runDir).filter((event) => event.type === 'gate' && event.action === 'presented')
}

function readHashes(runDir: string): Record<string, string> {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(runDir, 'gate-hashes-1.json'), 'utf8'))
  const out: Record<string, string> = {}
  if (parsed !== null && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[key] = value
    }
  }
  return out
}

describe('review work presents the full early gate (C4 seam face)', () => {
  it('a blocking cap-hit writes gate-<n>.md + gate-hashes-<n>.json before the presented event', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const halted = await startRun(pipeline.deps, { taskFile })
    expect(halted.halted).toBe('gate-pending')
    const runDir = pipeline.runDirOf(halted.runId)

    const gateMd = fs.readFileSync(path.join(runDir, 'gate-1.md'), 'utf8')
    expect(gateMd).toContain('Early gate')
    expect(gateMd).toContain('### Cap-hit blockers (answer or override)')
    expect(gateMd).toContain('F1')
    expect(gateMd).toContain('→ <answer or OVERRIDE>')
    expect(gateMd).toContain('→ RUN 1 MORE')
    expect(gateMd).toContain(`afk-runner resume ${halted.runId}`)

    const hashes = readHashes(runDir)
    expect(hashes['proposal.md']).toMatch(/^[0-9a-f]{64}$/u)

    expect(presentedEvents(runDir)).toHaveLength(1)
    expect(presentedEvents(runDir)[0]).toMatchObject({ mode: 'early', version: 1 })
  })

  it('a converged review presents no early gate files — the tail presents the final gate instead', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const halted = await startRun(pipeline.deps, { taskFile })
    const runDir = pipeline.runDirOf(halted.runId)
    expect(halted.halted).toBe('final')
    const presented = presentedEvents(runDir)
    expect(presented).toHaveLength(1)
    expect(presented[0]).toMatchObject({ mode: 'final', version: 1 })
  })
})
