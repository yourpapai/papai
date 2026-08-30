// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import type { Finding } from '../../sdd-runner/src/agent-layer.js'
import type { RunnerConfig } from '../../sdd-runner/src/config.js'
import { EventInputSchema } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import { resolveRound, runLenses } from '../../sdd-runner/src/review-agents.js'
import type { ReviewLoopDeps } from '../../sdd-runner/src/review-loop.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-rag-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'F1',
  class: 'MATERIAL',
  gap: 'the proposal never names the scope id',
  question: 'q',
  code_evidence_attempted: 'e',
  ...overrides,
})

interface AgentsFixture {
  readonly deps: ReviewLoopDeps
  readonly changeDir: string
  readonly prompts: Map<string, string>
}

function makeAgentsFixture(dir: string, script: Record<string, string>): AgentsFixture {
  const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
  fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nstorage lands via a drizzle migration\n')
  fs.writeFileSync(path.join(changeDir, 'design.md'), '## Context\nschema ships as a hand-written migration\n')
  fs.writeFileSync(
    path.join(changeDir, 'specs', 'thing', 'spec.md'),
    '## ADDED Requirements\n### Requirement: X\n\nIt SHALL x.\n',
  )
  const emitted: EventInput[] = []
  const prompts = new Map<string, string>()
  const config: RunnerConfig = { repoRoot: dir, workDir: path.join(dir, '.sdd-runner'), model: 'test-model', budget: 5 }
  const spawn: SpawnFn = (_command, args, options) => {
    const prompt = String(args[args.length - 1])
    const match = prompt.match(/\.review-loop\/([\w-]+\.json)/u)
    const basename = match?.[1] ?? 'unknown.json'
    prompts.set(basename, prompt)
    const target = path.join(options.cwd, '.review-loop', basename)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, script[basename] ?? '{"findings":[]}')
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  const deps: ReviewLoopDeps = {
    agent: { spawn, config, execGit: () => Promise.resolve({ stdout: '', stderr: '' }), emit: () => undefined },
    emit: (event) => {
      emitted.push(EventInputSchema.parse(event))
    },
    sidecarDir: path.join(dir, 'sidecars'),
    runDir: dir,
    cwd: dir,
    materialize: () => Promise.resolve(),
  }
  return { deps, changeDir, prompts }
}

const options = { changeName: 'add-thing', depth: 'L' as const, taskText: 'x', conventions: 'y', changeDir: '' }

describe('runLenses (review-agents)', () => {
  it('merges lens findings by fingerprint and appends the consistency scan', async () => {
    const dir = makeDir()
    const fixture = makeAgentsFixture(dir, {
      'findings-1.json': JSON.stringify({ findings: [finding()] }),
      'findings-skeptic-1.json': JSON.stringify({
        findings: [finding({ id: 'S1', gap: 'The proposal never names the scope ID!' })],
      }),
    })
    const merged = await runLenses(fixture.deps, { ...options, changeDir: fixture.changeDir }, 1, 0, undefined)
    const ids = merged.map((entry) => entry.id)
    expect(ids).toEqual(['F1', 'C1'])
    expect(merged[1]?.gap).toContain('drizzle migration')
    expect(merged[1]?.gap).toContain('hand-written migration')
  })

  it('enforces the skeptic S-prefix convention, failing validation under the skeptic lens label', async () => {
    const dir = makeDir()
    const fixture = makeAgentsFixture(dir, {
      'findings-1.json': JSON.stringify({ findings: [finding()] }),
      'findings-skeptic-1.json': JSON.stringify({ findings: [finding({ id: 'F9' })] }),
    })
    const rejection = await runLenses(
      fixture.deps,
      { ...options, changeDir: fixture.changeDir },
      1,
      0,
      undefined,
    ).catch((error: unknown) => error)
    expect(rejection instanceof Error).toBe(true)
    assert(rejection instanceof Error)
    expect(rejection.message).toMatch(/skeptic-r1 failed validation/u)
    expect(rejection.message).toMatch(/S-prefix/u)
  })

  it('continues the resumed session for the matching lens spawn only', async () => {
    const dir = makeDir()
    const fixture = makeAgentsFixture(dir, {
      'findings-1.json': JSON.stringify({ findings: [finding()] }),
      'findings-skeptic-1.json': JSON.stringify({ findings: [] }),
    })
    const spawnCalls: string[][] = []
    const baseSpawn = fixture.deps.agent.spawn
    const spawn: SpawnFn = (command, args, spawnOptions, onLine) => {
      spawnCalls.push([...args])
      return baseSpawn(command, args, spawnOptions, onLine)
    }
    const agent = { ...fixture.deps.agent, spawn }
    const deps: ReviewLoopDeps = { ...fixture.deps, agent }
    const merged = await runLenses(deps, { ...options, changeDir: fixture.changeDir }, 1, 0, {
      label: 'reviewer-r1',
      opencodeSessionId: 'sess-review',
      round: 1,
    })
    expect(merged.map((entry) => entry.id)).toEqual(['F1', 'C1'])
    expect(spawnCalls).toHaveLength(2)
    expect(spawnCalls.filter((args) => args.includes('sess-review'))).toHaveLength(1)
  })
})

describe('resolveRound (review-agents)', () => {
  const isResolvedFinding = (event: EventInput): event is Extract<EventInput, { type: 'finding' }> =>
    event.type === 'finding' && event.action === 'resolved'
  const isFindingEventFor =
    (id: string) =>
    (event: EventInput): event is Extract<EventInput, { type: 'finding' }> =>
      event.type === 'finding' && event.id === id
  const isFindingEvent = (event: EventInput): event is Extract<EventInput, { type: 'finding' }> =>
    event.type === 'finding'
  const isAssumptionEvent = (event: EventInput): event is Extract<EventInput, { type: 'assumption' }> =>
    event.type === 'assumption'
  const isSpawnedEvent = (event: EventInput): event is Extract<EventInput, { type: 'spawned' }> =>
    event.type === 'spawned'

  it('resolves merged findings and emits fingerprinted resolution events', async () => {
    const dir = makeDir()
    const fixture = makeAgentsFixture(dir, {
      'resolutions-1.json': JSON.stringify({
        resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'edited', outcome: 'fixed' }],
        assumptions: [],
      }),
    })
    const emitted: EventInput[] = []
    const deps: ReviewLoopDeps = {
      ...fixture.deps,
      emit: (event) => {
        emitted.push(EventInputSchema.parse(event))
      },
    }
    const merged: readonly Finding[] = [finding()]
    const resolved = await resolveRound(deps, { ...options, changeDir: fixture.changeDir }, 1, merged, undefined)
    expect(resolved.resolutions).toHaveLength(1)
    const resolutionEvent = emitted.find(isResolvedFinding)
    expect(resolutionEvent?.fingerprint).toBe('id names never proposal scope')
  })

  it('emits a dismissed resolution with the dismissed action, not resolved', async () => {
    const dir = makeDir()
    const fixture = makeAgentsFixture(dir, {
      'resolutions-1.json': JSON.stringify({
        resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'dismissed', justification: 'cosmetic' }],
        assumptions: [],
      }),
    })
    const emitted: EventInput[] = []
    const deps: ReviewLoopDeps = {
      ...fixture.deps,
      emit: (event) => {
        emitted.push(EventInputSchema.parse(event))
      },
    }
    await resolveRound(deps, { ...options, changeDir: fixture.changeDir }, 1, [finding()], undefined)
    const dismissedEvent = emitted.find(isFindingEventFor('F1'))
    expect(dismissedEvent).toMatchObject({ action: 'dismissed', class: 'NITPICK', round: 1 })
  })

  it('omits the fingerprint when the resolution does not join a merged finding', async () => {
    const dir = makeDir()
    const fixture = makeAgentsFixture(dir, {
      'resolutions-1.json': JSON.stringify({
        resolutions: [{ id: 'F9', class: 'MATERIAL', resolution: 'edited', outcome: 'fixed' }],
        assumptions: [],
      }),
    })
    const emitted: EventInput[] = []
    const deps: ReviewLoopDeps = {
      ...fixture.deps,
      emit: (event) => {
        emitted.push(EventInputSchema.parse(event))
      },
    }
    await resolveRound(deps, { ...options, changeDir: fixture.changeDir }, 1, [], undefined)
    const event = emitted.find(isFindingEvent)
    assert(event !== undefined)
    expect(event).toMatchObject({ id: 'F9', action: 'resolved' })
    expect('fingerprint' in event).toBe(false)
  })

  it('logs each resolver assumption as an L2 assumption event', async () => {
    const dir = makeDir()
    const fixture = makeAgentsFixture(dir, {
      'resolutions-1.json': JSON.stringify({
        resolutions: [],
        assumptions: [
          {
            id: 'A1',
            text: 'the scope id is stable across threads',
            basis: 'code-evidence',
            confidence: 'high',
            blast_radius: 'src/chat',
            status: 'open',
            evidence: { files: ['src/chat/router.ts'] },
          },
        ],
      }),
    })
    const emitted: EventInput[] = []
    const deps: ReviewLoopDeps = {
      ...fixture.deps,
      emit: (event) => {
        emitted.push(EventInputSchema.parse(event))
      },
    }
    await resolveRound(deps, { ...options, changeDir: fixture.changeDir }, 1, [], undefined)
    const assumptionEvent = emitted.find(isAssumptionEvent)
    expect(assumptionEvent).toMatchObject({ altitude: 'L2', type: 'assumption', action: 'logged', id: 'A1' })
  })

  it('continues the resumed resolver session and names the resolver role in the spawn event', async () => {
    const dir = makeDir()
    const fixture = makeAgentsFixture(dir, {
      'resolutions-1.json': JSON.stringify({ resolutions: [], assumptions: [] }),
    })
    const spawnCalls: string[][] = []
    const agentEmitted: EventInput[] = []
    const baseSpawn = fixture.deps.agent.spawn
    const spawn: SpawnFn = (command, args, spawnOptions, onLine) => {
      spawnCalls.push([...args])
      return baseSpawn(command, args, spawnOptions, onLine)
    }
    const agent = {
      ...fixture.deps.agent,
      spawn,
      emit: (event: EventInput): void => {
        agentEmitted.push(EventInputSchema.parse(event))
      },
    }
    const deps: ReviewLoopDeps = { ...fixture.deps, agent }
    await resolveRound(deps, { ...options, changeDir: fixture.changeDir }, 1, [], {
      label: 'resolver-r1',
      opencodeSessionId: 'sess-resolve',
      round: 1,
    })
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]?.includes('sess-resolve')).toBe(true)
    const spawnedEvent = agentEmitted.find(isSpawnedEvent)
    expect(spawnedEvent).toMatchObject({ agent: 'resolver-r1', role: 'resolver' })
  })
})
