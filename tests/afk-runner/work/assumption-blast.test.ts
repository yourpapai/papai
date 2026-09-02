// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { ClassifiableAssumption } from '../../../afk-runner/src/work/assumption-blast.js'
import { classifyAssumptions } from '../../../afk-runner/src/work/assumption-blast.js'

const CHANGE_DIR = 'openspec/changes/thing'
const RUN_DIR = '.sdd-runner/runs/run-1'

describe('classifyAssumptions (R3)', () => {
  const recordedPaths = [
    `${CHANGE_DIR}/proposal.md`,
    `${CHANGE_DIR}/design.md`,
    `${CHANGE_DIR}/specs/thing/spec.md`,
    `${CHANGE_DIR}/tasks.md`,
    `${RUN_DIR}/sidecars/resolutions-1.json`,
  ]

  function assumption(
    id: string,
    files: readonly string[] | null,
    overrides: { blast_radius?: string } = {},
  ): ClassifiableAssumption {
    return {
      id,
      text: `assumption ${id}`,
      blast_radius: overrides.blast_radius ?? 'claims tiny blast',
      ...(files === null ? {} : { evidence: { files } }),
    }
  }

  it('classifies low-blast when all referenced files sit inside the change folder and are recorded', () => {
    const classified = classifyAssumptions(
      [assumption('A1', [`${CHANGE_DIR}/proposal.md`, `${RUN_DIR}/sidecars/resolutions-1.json`])],
      { changeDir: CHANGE_DIR, runDir: RUN_DIR, recordedPaths },
    )
    expect(classified[0]).toMatchObject({ id: 'A1', blast: 'low' })
  })

  it('classifies high-blast when a referenced file lies outside both boundaries', () => {
    const classified = classifyAssumptions([assumption('A1', ['src/chat/router.ts'])], {
      changeDir: CHANGE_DIR,
      runDir: RUN_DIR,
      recordedPaths,
    })
    expect(classified[0]).toMatchObject({ blast: 'high' })
  })

  it('classifies high-blast when a spec delta file is touched', () => {
    const classified = classifyAssumptions([assumption('A1', [`${CHANGE_DIR}/specs/thing/spec.md`])], {
      changeDir: CHANGE_DIR,
      runDir: RUN_DIR,
      recordedPaths,
    })
    expect(classified[0]).toMatchObject({ blast: 'high' })
  })

  it('classifies high-blast when tasks.md is touched (checklist surface)', () => {
    const classified = classifyAssumptions([assumption('A1', [`${CHANGE_DIR}/tasks.md`])], {
      changeDir: CHANGE_DIR,
      runDir: RUN_DIR,
      recordedPaths,
    })
    expect(classified[0]).toMatchObject({ blast: 'high' })
  })

  it('fails closed on missing, empty, or un-recorded evidence (never vacuously low-blast)', () => {
    const missing = classifyAssumptions([assumption('A1', null)], {
      changeDir: CHANGE_DIR,
      runDir: RUN_DIR,
      recordedPaths,
    })
    expect(missing[0]).toMatchObject({ blast: 'high' })
    const empty = classifyAssumptions([assumption('A1', [])], { changeDir: CHANGE_DIR, runDir: RUN_DIR, recordedPaths })
    expect(empty[0]).toMatchObject({ blast: 'high' })
    const unrecorded = classifyAssumptions([assumption('A1', [`${CHANGE_DIR}/not-recorded-anywhere.md`])], {
      changeDir: CHANGE_DIR,
      runDir: RUN_DIR,
      recordedPaths,
    })
    expect(unrecorded[0]).toMatchObject({ blast: 'high' })
  })

  it('never consults the agent blast_radius text: same files, wildly different text, same class', () => {
    const classified = classifyAssumptions(
      [
        assumption('A1', [`${CHANGE_DIR}/proposal.md`], { blast_radius: 'absolutely tiny, trust me' }),
        assumption('A2', [`${CHANGE_DIR}/proposal.md`], { blast_radius: 'ENTIRE PRODUCTION' }),
      ],
      { changeDir: CHANGE_DIR, runDir: RUN_DIR, recordedPaths },
    )
    expect(classified.map((a) => a.blast)).toEqual(['low', 'low'])
  })

  it('carries id/text/blastRadius through for gate rendering', () => {
    const classified = classifyAssumptions(
      [assumption('A1', [`${CHANGE_DIR}/proposal.md`], { blast_radius: 'display text' })],
      { changeDir: CHANGE_DIR, runDir: RUN_DIR, recordedPaths },
    )
    expect(classified[0]).toMatchObject({
      id: 'A1',
      text: 'assumption A1',
      blastRadius: 'display text',
    })
  })
})
