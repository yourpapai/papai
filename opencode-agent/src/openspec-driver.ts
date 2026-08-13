// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { CommandRunner, CommandResult } from './shell.js'

/**
 * The thin TypeScript seam over the `openspec` CLI — design D3.
 *
 * The same division of labour the archived `sdd-runner` established: TypeScript
 * owns the CLI protocol (argv vectors, JSON decoding, exit-code handling), the
 * model composes artifact content only. Re-implemented here rather than imported
 * because `sdd-runner` is a peer workspace this agent never depended on, and the
 * compliance idiom is a pattern to adopt, not a module to couple to.
 *
 * Every command runs through the injected {@link CommandRunner}, which spawns
 * argv vectors with `shell: false` — the same boundary that keeps untrusted
 * issue text out of `/bin/sh` everywhere else in this workspace.
 */

/** Spawned-command seam shared with every other external boundary here. */
export interface OpenSpecDriverDeps {
  readonly runner: CommandRunner
  readonly cwd: string
  /** Defaults to `openspec`; overridable for a pinned install path. */
  readonly binary?: string
}

export interface NewChangeResult {
  readonly changeName: string
}

export interface StatusResult {
  readonly schemaName: string
  readonly artifacts: Record<string, string>
  readonly isPlanningComplete: boolean
}

export interface InstructionDependency {
  readonly id: string
  readonly done?: boolean
  readonly path?: string
  readonly description?: string
}

export interface InstructionsResult {
  readonly instruction: string
  readonly template: string | undefined
  readonly rules: readonly string[]
  readonly resolvedOutputPath: string
  /**
   * The change folder, when the CLI reported one.
   *
   * Only one artifact needs it and that is the point: the `spec-driven` schema's
   * `specs` artifact resolves to a **pattern** (`<changeDir>/specs/**\/*.md`),
   * because a change carries one delta spec per capability, so the drafter has
   * to choose the concrete paths — and it chooses them relative to this, which
   * is how the artifact instruction itself spells them
   * (`specs/<capability-path>/spec.md`).
   *
   * Optional rather than required, like every other field here but
   * `resolvedOutputPath`: every phase reads `instructions`, so a field only the
   * glob artifact needs must not be what fails them all on a CLI that stops
   * emitting it. `glob-output.ts` derives a base when it is absent.
   */
  readonly changeDir: string | undefined
  readonly existingOutputPaths: readonly string[]
  readonly dependencies: readonly InstructionDependency[]
}

export interface ValidateResult {
  readonly ok: boolean
  /** Combined stdout+stderr; the drafter's retry attaches this as the complaint. */
  readonly output: string
}

export interface OpenSpecDriver {
  readonly newChange: (changeName: string, schema: string) => Promise<NewChangeResult>
  readonly status: (changeName: string) => Promise<StatusResult>
  readonly instructions: (artifactId: string, changeName: string) => Promise<InstructionsResult>
  readonly validateStrict: (changeName: string) => Promise<ValidateResult>
  readonly archive: (changeName: string) => Promise<void>
}

const StatusArtifactSchema = z.object({ id: z.string().min(1), status: z.string().min(1) })

const StatusPayloadSchema = z.object({
  schemaName: z.string().min(1),
  artifacts: z.array(StatusArtifactSchema),
  isPlanningComplete: z.boolean().optional(),
})

const InstructionDependencySchema = z.object({
  id: z.string(),
  done: z.boolean().optional(),
  path: z.string().optional(),
  description: z.string().optional(),
})

const InstructionsPayloadSchema = z.object({
  instruction: z.string(),
  template: z.string().optional(),
  rules: z.array(z.string()).optional(),
  resolvedOutputPath: z.string().min(1),
  changeDir: z.string().min(1).optional(),
  existingOutputPaths: z.array(z.string()).optional(),
  dependencies: z.array(InstructionDependencySchema).optional(),
})

const argvFor = (deps: OpenSpecDriverDeps, args: readonly string[]): readonly string[] => [
  deps.binary ?? 'openspec',
  ...args,
]

/**
 * Runs a command that is expected to succeed and throws naming the subcommand
 * when it does not. Used by everything except `validateStrict`, whose non-zero
 * exit is an ordinary result the drafter decides what to do with.
 */
const runExpectOk = async (deps: OpenSpecDriverDeps, args: readonly string[], label: string): Promise<string> => {
  const result = await deps.runner(argvFor(deps, args), { cwd: deps.cwd })
  if (result.exitCode !== 0) {
    throw new Error(`openspec ${label} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

const parseJson = (stdout: string, label: string): unknown => {
  try {
    return JSON.parse(stdout)
  } catch (error) {
    throw new Error(`openspec ${label}: unparseable JSON output`, { cause: error })
  }
}

export function createOpenSpecDriver(deps: OpenSpecDriverDeps): OpenSpecDriver {
  return {
    newChange: async (changeName, schema) => {
      await runExpectOk(deps, ['new', 'change', changeName, '--schema', schema], 'new change')
      return { changeName }
    },

    status: async (changeName) => {
      const stdout = await runExpectOk(deps, ['status', '--change', changeName, '--json'], 'status')
      const payload = StatusPayloadSchema.parse(parseJson(stdout, 'status'))
      const artifacts: Record<string, string> = {}
      for (const artifact of payload.artifacts) artifacts[artifact.id] = artifact.status
      return { schemaName: payload.schemaName, artifacts, isPlanningComplete: payload.isPlanningComplete ?? false }
    },

    instructions: async (artifactId, changeName) => {
      const stdout = await runExpectOk(
        deps,
        ['instructions', artifactId, '--change', changeName, '--json'],
        'instructions',
      )
      const payload = InstructionsPayloadSchema.parse(parseJson(stdout, 'instructions'))
      return {
        instruction: payload.instruction,
        template: payload.template,
        rules: payload.rules ?? [],
        resolvedOutputPath: payload.resolvedOutputPath,
        changeDir: payload.changeDir,
        existingOutputPaths: payload.existingOutputPaths ?? [],
        dependencies: payload.dependencies ?? [],
      }
    },

    validateStrict: async (changeName) => {
      const result: CommandResult = await deps.runner(argvFor(deps, ['validate', changeName, '--strict']), {
        cwd: deps.cwd,
      })
      return { ok: result.exitCode === 0, output: `${result.stdout}${result.stderr}` }
    },

    archive: async (changeName) => {
      await runExpectOk(deps, ['archive', changeName], 'archive')
    },
  }
}
