// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { readEvents } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { processExpiry } from '../../../afk-runner/src/work/gate-expiry.js'
import type { ExpiryPorts } from '../../../afk-runner/src/work/gate-expiry.js'

const PAST = '2026-08-27T00:00:01.000Z'
const NOW = new Date('2026-08-27T00:01:00.000Z')

function isAnsweredGateEvent(event: SddEvent): boolean {
  return event.type === 'gate' && event.action === 'answered'
}

function isApproveDecision(event: SddEvent): boolean {
  return event.type === 'auto_decision' && event.decision === 'approve'
}

interface ExpiryFixture {
  readonly runDir: string
  readonly expiry: () => ReturnType<typeof processExpiry>
}

/** A final-mode gate parked awaiting with its deadline already elapsed. */
function expiredFinalGate(resolutionsBody: string): ExpiryFixture {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-gate-expiry-'))
  const changeDir = path.join(runDir, 'change')
  const sidecarDir = path.join(runDir, 'sidecars')
  fs.mkdirSync(sidecarDir, { recursive: true })
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'hello')
  fs.writeFileSync(path.join(sidecarDir, 'resolutions-1.json'), resolutionsBody)
  const logPath = path.join(runDir, 'events.ndjson')
  const prelude: readonly EventInput[] = [
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
    { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
    { altitude: 'L2', type: 'artifact', action: 'materialized', path: 'change/proposal.md' },
    { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
    { altitude: 'L2', type: 'stage_enter', stage: 'review' },
    { altitude: 'L2', type: 'round_open', round: 1, cap: 1 },
    { altitude: 'L2', type: 'stage_exit', stage: 'review' },
    { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1, deadlineAt: PAST },
  ]
  for (const event of prelude) appendEvent(logPath, event, NOW)
  fs.writeFileSync(path.join(runDir, 'gate-1.md'), `<!-- gate-1.md -->\n\n## Final gate — change add-thing\n`)
  fs.writeFileSync(path.join(runDir, 'gate-hashes-1.json'), '{}\n')
  const ports: ExpiryPorts = {
    runDir,
    logPath,
    sidecarDir,
    changeDir,
    machine: pipelineMachine,
    emit: (event) => {
      appendEvent(logPath, event, NOW)
    },
    stdout: () => undefined,
    repoRoot: runDir,
    autonomy: { level: 'assist', costCeilingUsd: 5, metered: true },
    now: () => NOW,
  }
  return {
    runDir,
    expiry: () => processExpiry(ports, 1, 'final', { current: 1, cap: 1 }, PAST, false, null),
  }
}

describe('gate expiry — machine-producer refusal alarm (D1)', () => {
  it('a settle that cannot land stays crash-shaped: an unreadable hashes sidecar rejects the approve loudly', async () => {
    // The ladder picked R1 (converged, nothing open, low blast) and wrote the
    // response — the presentation-time hashes sidecar is unreadable, so the
    // post-write integrity verification rejects. A machine producer never
    // swallows a rejection: the expiry must throw, never silently no-op.
    // (The pre-write rejection shape — the seam returning {kind: 'rejected'}
    // before anything lands — is pinned at the prelude producer, which takes
    // its review result as a parameter; the expiry's own inputs are
    // internally consistent, so only engine bugs can reach its rethrow.)
    const fixture = expiredFinalGate(JSON.stringify({ resolutions: [], assumptions: [] }))
    fs.writeFileSync(path.join(fixture.runDir, 'gate-hashes-1.json'), '{not json')
    await expect(fixture.expiry()).rejects.toThrow(/producer settle failed after write/u)
    const events = readEvents(path.join(fixture.runDir, 'events.ndjson'))
    expect(events.some(isAnsweredGateEvent)).toBe(false)
    expect(fs.existsSync(path.join(fixture.runDir, 'gate-1.settle-claim'))).toBe(false)
  })

  it('an agreed expiry settle still lands through the seam (the wiring above the rethrow)', async () => {
    const fixture = expiredFinalGate(JSON.stringify({ resolutions: [], assumptions: [] }))
    const result = await fixture.expiry()
    expect(result).toEqual({ kind: 'settled', outcome: 'approve' })
    const events = readEvents(path.join(fixture.runDir, 'events.ndjson'))
    const answered = events.findIndex(isAnsweredGateEvent)
    const decision = events.findIndex(isApproveDecision)
    expect(answered).toBeGreaterThanOrEqual(0)
    expect(decision).toBeGreaterThan(answered)
  })
})
