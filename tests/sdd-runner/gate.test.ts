// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { EventInputSchema } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import { presentGate, resumeGate, vetoRedirects } from '../../sdd-runner/src/gate.js'
import type { GateDeps } from '../../sdd-runner/src/gate.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

interface Fixture {
  readonly deps: GateDeps
  readonly changeDir: string
  readonly runDir: string
  readonly emitted: EventInput[]
  readonly driftCalls: Array<readonly string[]>
}

function makeFixture(dir: string): Fixture {
  const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
  fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nx\n')
  fs.writeFileSync(path.join(changeDir, 'specs', 'thing', 'spec.md'), '## ADDED Requirements\n')
  fs.writeFileSync(path.join(changeDir, 'design.md'), '## Context\n')
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), '## 1. x\n- [ ] 1.1 y\n')
  const runDir = path.join(dir, 'run-1')
  fs.mkdirSync(runDir, { recursive: true })
  const driftCalls: Array<readonly string[]> = []
  const emitted: EventInput[] = []
  const deps: GateDeps = {
    emit: (event) => {
      emitted.push(EventInputSchema.parse(event))
    },
    runDir,
    changeDir,
    driftCheck: (files) => {
      driftCalls.push(files)
      return Promise.resolve()
    },
  }
  return { deps, changeDir, runDir, emitted, driftCalls }
}

describe('presentGate', () => {
  it('writes a versioned gate file, records artifact hashes, and emits a presented event', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    const result = await presentGate(fixture.deps, {
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [{ id: 'A1', text: 'guests read-only', blast_radius: 'group replies' }],
      blockers: [],
      summary: 'add a thing',
      costUsd: 0.5,
      durationMs: 1000,
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
    })
    expect(result.gateMdPath).toBe(path.join(fixture.runDir, 'gate-1.md'))
    expect(fs.existsSync(result.gateMdPath)).toBe(true)
    expect(fs.existsSync(path.join(fixture.runDir, 'gate-hashes-1.json'))).toBe(true)
    const events = fixture.emitted
    expect(events[0]).toMatchObject({ type: 'gate', action: 'presented', mode: 'final', version: 1 })
  })
})

describe('resumeGate', () => {
  it('approves when the human checks every assumption box', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await presentGate(fixture.deps, {
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      blockers: [],
      summary: 's',
      costUsd: 0,
      durationMs: 0,
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
    })
    const md = fs.readFileSync(path.join(fixture.runDir, 'gate-1.md'), 'utf8').replace('- [ ] A1', '- [x] A1')
    fs.writeFileSync(path.join(fixture.runDir, 'gate-1.md'), md)
    const outcome = await resumeGate(fixture.deps, {
      version: 1,
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      blockers: [],
    })
    expect(outcome.kind).toBe('approved')
    expect(fixture.driftCalls).toHaveLength(0)
  })

  it('returns vetoes with redirects when an assumption is left unchecked', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await presentGate(fixture.deps, {
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [
        { id: 'A1', text: 'first', blast_radius: 'y' },
        { id: 'A2', text: 'second', blast_radius: 'w' },
      ],
      blockers: [],
      summary: 's',
      costUsd: 0,
      durationMs: 0,
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
    })
    const md = fs
      .readFileSync(path.join(fixture.runDir, 'gate-1.md'), 'utf8')
      .replace('- [ ] A1 first', '- [ ] A1 first\n→ narrow it to dm-only')
      .replace('- [ ] A2 second', '- [x] A2 second')
    fs.writeFileSync(path.join(fixture.runDir, 'gate-1.md'), md)
    const outcome = await resumeGate(fixture.deps, {
      version: 1,
      assumptions: [
        { id: 'A1', text: 'first', blast_radius: 'y' },
        { id: 'A2', text: 'second', blast_radius: 'w' },
      ],
      blockers: [],
    })
    expect(outcome.kind).toBe('veto')
    expect(vetoRedirects(outcome)).toEqual([{ id: 'A1', redirect: 'narrow it to dm-only' }])
  })

  it('detects hand edits to specs or design and runs the drift check', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await presentGate(fixture.deps, {
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      blockers: [],
      summary: 's',
      costUsd: 0,
      durationMs: 0,
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
    })
    fs.writeFileSync(
      path.join(fixture.changeDir, 'specs', 'thing', 'spec.md'),
      '## ADDED Requirements\n### Requirement: Changed\n',
    )
    const md = fs.readFileSync(path.join(fixture.runDir, 'gate-1.md'), 'utf8').replace('- [ ] A1', '- [x] A1')
    fs.writeFileSync(path.join(fixture.runDir, 'gate-1.md'), md)
    const outcome = await resumeGate(fixture.deps, {
      version: 1,
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      blockers: [],
    })
    expect(outcome.kind).toBe('approved')
    expect(fixture.driftCalls[0]).toContain('specs/thing/spec.md')
  })

  it('aborts on an ABORT marker', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await presentGate(fixture.deps, {
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      blockers: [],
      summary: 's',
      costUsd: 0,
      durationMs: 0,
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
    })
    fs.writeFileSync(path.join(fixture.runDir, 'gate-1.md'), 'ABORT\n')
    const outcome = await resumeGate(fixture.deps, {
      version: 1,
      assumptions: [{ id: 'A1', text: 'x', blast_radius: 'y' }],
      blockers: [],
    })
    expect(outcome.kind).toBe('aborted')
  })
})
