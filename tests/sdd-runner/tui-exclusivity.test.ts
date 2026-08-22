// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { EventInput } from '../../sdd-runner/src/events.js'
import { stampEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { buildBus } from '../../sdd-runner/src/gate-digest.js'
import type { OpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'

function event(seq: number): EventInput {
  return stampEvent({ altitude: 'L2', type: 'stage_enter', stage: 'intake' }, seq, '2026-01-01T00:00:00.000Z')
}

function stubDriver(): OpenSpecDriver {
  return {
    newChange: () => Promise.resolve({ changeName: 'add-thing' }),
    status: () =>
      Promise.resolve({
        schemaName: 'auto-sdd',
        artifacts: {},
        isPlanningComplete: true,
      }),
    instructions: () =>
      Promise.resolve({
        instruction: '',
        template: undefined,
        rules: [],
        resolvedOutputPath: '',
        existingOutputPaths: [],
        dependencies: [],
      }),
    validateStrict: () => Promise.resolve({ ok: true, output: '' }),
  }
}

function depsWith(render?: (e: EventInput) => void, liveEvents?: (e: EventInput) => void): OrchestratorDeps {
  return {
    config: { repoRoot: '/repo', workDir: '/work', model: 'm', budget: 1 },
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: stubDriver(),
    ...(render === undefined ? {} : { render }),
    ...(liveEvents === undefined ? {} : { liveEvents }),
  }
}

describe('buildBus render exclusivity', () => {
  it('prefers the live view sink over the line renderer when both are present', () => {
    const rendered: EventInput[] = []
    const live: EventInput[] = []
    const emit = buildBus(
      depsWith(
        (e) => void rendered.push(e),
        (e) => void live.push(e),
      ),
      '/tmp/x.ndjson',
    )
    const e = event(1)
    emit(e)
    expect(live).toEqual([e])
    expect(rendered).toEqual([])
  })

  it('still feeds the line renderer when no live view sink exists', () => {
    const rendered: EventInput[] = []
    const emit = buildBus(
      depsWith((e) => void rendered.push(e)),
      '/tmp/x.ndjson',
    )
    const e = event(1)
    emit(e)
    expect(rendered).toEqual([e])
  })
})
