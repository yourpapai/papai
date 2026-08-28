// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createOpenSpecDriver } from '../../../afk-runner/src/openspec-driver.js'
import type { OpenSpecDriver } from '../../../afk-runner/src/openspec-driver.js'
import type { RunDeps } from '../../../afk-runner/src/run.js'
import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'
import { agentWritePath } from '../../../review-loop/src/agent-runner.js'

export interface FakePipeline {
  readonly deps: RunDeps
  readonly repoRoot: string
  readonly workDir: string
  readonly changeName: string
  readonly changeDir: string
  readonly spawnOrder: string[]
  readonly stdoutLines: string[]
  readonly runDirOf: (runId: string) => string
}

export interface FakePipelineOptions {
  /** Sidecar JSON bodies by basename, overriding the defaults (fake agents write these). */
  readonly sidecarOverrides?: Record<string, string>
  /**
   * Successive sidecar bodies by basename: each spawn for that basename
   * writes the next entry (the last sticks). Wins over overrides/defaults
   * while entries remain — the fail-once-then-succeed drill shape.
   */
  readonly sidecarSequences?: Record<string, readonly string[]>
  /** When given, a spawn whose output basename matches crashes (rejected spawn) — kill drill. */
  readonly crashOn?: (basename: string) => boolean
}

export const TASK_TEXT = '# Add thing\n\nfixes a typo in the readme\n'

const BLOCKER_ROUND = {
  'findings-1.json': JSON.stringify({
    findings: [
      {
        id: 'F1',
        class: 'BLOCKER',
        gap: 'the proposal lacks a rollback story',
        question: 'how do we roll back?',
        code_evidence_attempted: 'searched the repo, none found',
      },
    ],
  }),
  'resolutions-1.json': JSON.stringify({
    resolutions: [
      {
        id: 'F1',
        class: 'BLOCKER',
        resolution: 'edited',
        outcome: 'added a rollback section',
      },
    ],
    assumptions: [],
  }),
}

/** Depth-M multi-round shape: cross-module estimator signal, blocker round 1, clean round 2. */
const M_MULTI_ROUND = {
  'depth.json': JSON.stringify({
    implicated_files: ['src/a.ts', 'src/b.ts'],
    signals: {
      cross_module: true,
      db_migration: false,
      provider_surface: false,
      credentials: false,
      novelty: 'existing-modules',
    },
    rationale: 'two modules',
  }),
  'draft-design.json': JSON.stringify({
    files_written: ['openspec/changes/add-thing/design.md'],
  }),
  ...BLOCKER_ROUND,
  'findings-2.json': JSON.stringify({ findings: [] }),
  'resolutions-2.json': JSON.stringify({ resolutions: [], assumptions: [] }),
}

/**
 * A full fake-agent pipeline: spawn writes the sidecar/artifact the prompt
 * asks for and returns exit 0 (the tests/sdd-runner orchestrator pattern).
 * Default sidecars classify depth S and converge review round 1; pass
 * `BLOCKER_ROUND` as overrides for the cap-hit/gate-pending flavor.
 */
export function makeFakePipeline(options: FakePipelineOptions = {}): FakePipeline {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-fake-'))
  const changeName = 'add-thing'
  const changeDir = path.join(repoRoot, 'openspec', 'changes', changeName)
  const workDir = path.join(repoRoot, '.sdd-runner')
  const spawnOrder: string[] = []
  const stdoutLines: string[] = []
  const sequenceWrites: Record<string, number> = {}

  const sidecars: Record<string, string> = {
    'depth.json': JSON.stringify({
      implicated_files: ['src/thing.ts'],
      signals: {
        cross_module: false,
        db_migration: false,
        provider_surface: false,
        credentials: false,
        novelty: 'existing-modules',
      },
      rationale: 'one module',
    }),
    'draft-proposal.json': JSON.stringify({
      files_written: ['openspec/changes/add-thing/proposal.md'],
    }),
    'draft-specs.json': JSON.stringify({
      files_written: ['openspec/changes/add-thing/specs/thing/spec.md'],
    }),
    'findings-1.json': JSON.stringify({ findings: [] }),
    'resolutions-1.json': JSON.stringify({ resolutions: [], assumptions: [] }),
    'decompose-tasks.json': JSON.stringify({ tasks_file: 'openspec/changes/add-thing/tasks.md' }),
    'atomicity.json': JSON.stringify({ split: 0, merged: 0 }),
    ...options.sidecarOverrides,
  }
  const artifacts: Record<string, string> = {
    'draft-proposal.json': path.join(changeDir, 'proposal.md'),
    'draft-specs.json': path.join(changeDir, 'specs', 'thing', 'spec.md'),
    'draft-design.json': path.join(changeDir, 'design.md'),
    'decompose-tasks.json': path.join(changeDir, 'tasks.md'),
  }

  const spawn: SpawnFn = (_command, args, spawnOptions) => {
    const prompt = String(args[args.length - 1])
    const match = prompt.match(/\.review-loop\/([\w-]+\.json)/u)
    const basename = match?.[1] ?? 'unknown.json'
    spawnOrder.push(basename)
    if (options.crashOn?.(basename) === true) {
      return Promise.reject(new Error(`simulated kill before ${basename}`))
    }
    const artifact = artifacts[basename]
    if (artifact !== undefined) {
      fs.mkdirSync(path.dirname(artifact), { recursive: true })
      fs.writeFileSync(artifact, `<!-- content for ${basename} -->\n`)
    }
    const sequence = options.sidecarSequences?.[basename]
    let body = sidecars[basename] ?? '{}'
    if (sequence !== undefined && sequence.length > 0) {
      const written = sequenceWrites[basename] ?? 0
      sequenceWrites[basename] = written + 1
      body = sequence[Math.min(written, sequence.length - 1)] ?? body
    }
    const target = agentWritePath(spawnOptions.cwd, basename)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, body)
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }

  const driverExec = (args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const [_bin, subcommand, ...rest] = args
    if (subcommand === 'new' && rest[0] === 'change') {
      fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
    }
    if (subcommand === 'instructions') {
      const artifactId = rest[0]
      const resolved =
        artifactId === 'specs'
          ? path.join(changeDir, 'specs', 'thing', 'spec.md')
          : path.join(changeDir, `${artifactId}.md`)
      return Promise.resolve({
        stdout: JSON.stringify({ instruction: `write the ${artifactId}`, resolvedOutputPath: resolved }),
        stderr: '',
        exitCode: 0,
      })
    }
    if (subcommand === 'validate') {
      return Promise.resolve({ stdout: 'is valid', stderr: '', exitCode: 0 })
    }
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
  }
  const driver: OpenSpecDriver = createOpenSpecDriver({ exec: driverExec, cwd: repoRoot })

  const deps: RunDeps = {
    config: { repoRoot, workDir, model: 'test-model', budget: 5 },
    spawn,
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver,
    stdout: (line) => {
      stdoutLines.push(line)
    },
  }
  return {
    deps,
    repoRoot,
    workDir,
    changeName,
    changeDir,
    spawnOrder,
    stdoutLines,
    runDirOf: (runId: string): string => path.join(workDir, 'runs', runId),
  }
}

export { BLOCKER_ROUND, M_MULTI_ROUND }
