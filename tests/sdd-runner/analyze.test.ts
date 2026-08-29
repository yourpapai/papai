// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AnalyzeFs, AnalyzeGit } from '../../sdd-runner/src/analyze-io.js'
import { loadRunBundle, nodeAnalyzeFs, readOnlyGit } from '../../sdd-runner/src/analyze-io.js'

const dirs: string[] = []
function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdd-analyze-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Type-level no-write pin (D2): if `AnalyzeFs` ever grows a write-capable
 * member this union stops being `never` and the call below fails the
 * typecheck. The runtime key set is pinned separately in the seam test.
 */
type WRITE_CAPABLE_FS_KEYS =
  | 'writeFile'
  | 'appendFile'
  | 'rm'
  | 'mkdir'
  | 'rmdir'
  | 'rename'
  | 'unlink'
  | 'cp'
  | 'write'
  | 'createWriteStream'
type PresentWriteKeys = Extract<keyof AnalyzeFs, WRITE_CAPABLE_FS_KEYS>
/** If AnalyzeFs ever grows a write member this type stops being `true` and the return below fails to typecheck. */
type NoWriteMembers = PresentWriteKeys extends never ? true : never

function pinNoWriteMembers(): true {
  const noWriteMembers: NoWriteMembers = true
  return noWriteMembers
}

describe('read-only IO seam (1.1)', () => {
  it('the injected fs exposes only readFile/readdir/stat — no write members', () => {
    expect(pinNoWriteMembers()).toBe(true)
    expect(Object.keys(nodeAnalyzeFs()).sort()).toEqual(['readFile', 'readdir', 'stat'])
  })

  it('the git wrapper allows log and ls-tree and rejects every other subcommand', async () => {
    const seen: string[][] = []
    const fake: AnalyzeGit = (_cwd, args) => {
      seen.push([...args])
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    const guarded = readOnlyGit(fake)
    await guarded('/repo', ['log', '--pretty=format:%h %s'])
    await guarded('/repo', ['ls-tree', 'master', 'openspec/changes/kb'])
    await expect(guarded('/repo', ['status'])).rejects.toThrow(/read-only.*status/u)
    await expect(guarded('/repo', ['push', 'origin', 'master'])).rejects.toThrow(/read-only.*push/u)
    await expect(guarded('/repo', [])).rejects.toThrow(/read-only/u)
    expect(seen).toEqual([
      ['log', '--pretty=format:%h %s'],
      ['ls-tree', 'master', 'openspec/changes/kb'],
    ])
  })
})

describe('run loading (1.2)', () => {
  it('loads a full run bundle: state, events, sidecars, gate files, expiry claims', async () => {
    const workDir = makeDir()
    const runDir = path.join(workDir, 'runs', 'modern-run')
    seedState(runDir, { runId: 'modern-run', changeName: 'fix-command', status: 'completed' })
    writeFileSync(
      path.join(runDir, 'events.ndjson'),
      [
        { altitude: 'L2', type: 'round_open', round: 1, cap: 3, seq: 1, ts: '2026-08-23T19:41:00.000Z' },
        {
          altitude: 'L2',
          type: 'finding',
          action: 'filed',
          id: 'F1',
          round: 1,
          class: 'MATERIAL',
          seq: 2,
          ts: '2026-08-23T19:42:00.000Z',
        },
        {
          altitude: 'L2',
          type: 'convergence',
          round: 1,
          verdict: 'open',
          counts: { blocker: 0, material: 2, nitpick: 1 },
          seq: 3,
          ts: '2026-08-23T19:43:00.000Z',
        },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n')
        .concat('\n'),
    )
    const sidecars = path.join(runDir, 'sidecars')
    mkdirSync(sidecars, { recursive: true })
    writeFileSync(
      path.join(sidecars, 'findings-1.json'),
      JSON.stringify({
        findings: [
          {
            id: 'F1',
            class: 'MATERIAL',
            gap: 'the design asserts X',
            question: 'why?',
            code_evidence_attempted: 'checked',
          },
        ],
      }),
    )
    writeFileSync(
      path.join(sidecars, 'resolutions-1.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'fixed' }],
      }),
    )
    writeFileSync(path.join(runDir, 'gate-1.md'), '## Gate response\n')
    writeFileSync(path.join(runDir, 'gate-1.expiry-claim'), '2026-08-23T20:00:00.000Z\n')

    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'modern-run')

    expect(bundle.state?.changeName).toBe('fix-command')
    expect(bundle.events.map((event) => event.type)).toEqual(['round_open', 'finding', 'convergence'])
    expect(bundle.droppedEventLines).toBe(0)
    expect(bundle.findings).toHaveLength(1)
    expect(bundle.findings[0]?.items[0]?.id).toBe('F1')
    expect(bundle.resolutions).toHaveLength(1)
    expect(bundle.gateFiles).toEqual([{ version: 1, md: '## Gate response\n' }])
    expect(bundle.expiryClaimVersions).toEqual([1])
    expect(bundle.stateBak).toBe(false)
  })

  it('a pre-skeptic-era run loads with reduced coverage instead of failing', async () => {
    const workDir = makeDir()
    const runDir = path.join(workDir, 'runs', 'legacy-run')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      path.join(runDir, 'events.ndjson'),
      [
        JSON.stringify({
          altitude: 'L2',
          type: 'depth',
          profile: 'S',
          rationale: 'small',
          source: 'override',
          seq: 1,
          ts: '2026-08-01T00:00:00.000Z',
        }),
        // an event vocabulary the current schema does not know: dropped, not fatal
        JSON.stringify({ altitude: 'L9', type: 'legacy_thing', seq: 2, ts: '2026-08-01T00:00:01.000Z' }),
      ]
        .join('\n')
        .concat('\n'),
    )

    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'legacy-run')

    expect(bundle.state).toBeNull()
    expect(bundle.events).toHaveLength(1)
    expect(bundle.droppedEventLines).toBe(1)
    expect(bundle.findings).toEqual([])
    expect(bundle.resolutions).toEqual([])
    expect(bundle.gateFiles).toEqual([])
  })

  it('a corrupt sidecar counts as a parse failure and the rest of the bundle still loads', async () => {
    const workDir = makeDir()
    const runDir = path.join(workDir, 'runs', 'partial-run')
    mkdirSync(runDir, { recursive: true })
    const sidecars = path.join(runDir, 'sidecars')
    mkdirSync(sidecars, { recursive: true })
    writeFileSync(path.join(sidecars, 'findings-1.json'), '{not json')
    writeFileSync(
      path.join(sidecars, 'resolutions-1.json'),
      JSON.stringify({ resolutions: [{ id: 'F2', class: 'NITPICK', resolution: 'dismissed', justification: 'dup' }] }),
    )

    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'partial-run')

    expect(bundle.findings).toEqual([])
    expect(bundle.resolutions).toHaveLength(1)
    expect(bundle.sidecarFailures).toBe(1)
  })
})

/** Minimal state.json seeder shared by the loading fixtures. */
function seedState(runDir: string, overrides: { runId: string; changeName: string; status: string }): void {
  mkdirSync(runDir, { recursive: true })
  const now = '2026-08-23T19:40:00.000Z'
  writeFileSync(
    path.join(runDir, 'state.json'),
    JSON.stringify({
      runId: overrides.runId,
      repoRoot: path.dirname(path.dirname(runDir)),
      workDir: path.dirname(runDir),
      changeName: overrides.changeName,
      stage: 'gate',
      depth: 'M',
      round: 1,
      gate: null,
      status: overrides.status,
      createdAt: now,
      updatedAt: now,
      autoExtendsUsed: 0,
      gateDeadlineAt: null,
      gateDeadlineReArmed: false,
    }),
  )
}
