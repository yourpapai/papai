// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export type ExecFn = (
  args: readonly string[],
  options: { readonly cwd: string },
) => Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }>

export interface OpenSpecDriverDeps {
  readonly exec: ExecFn
  readonly cwd: string
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
  readonly existingOutputPaths: readonly string[]
  readonly dependencies: readonly InstructionDependency[]
}

export interface ValidateResult {
  readonly ok: boolean
  readonly output: string
}

const StatusPayloadSchema = z.object({
  schemaName: z.string().min(1),
  artifacts: z.array(z.object({ id: z.string().min(1), status: z.string().min(1) })),
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
  existingOutputPaths: z.array(z.string()).optional(),
  dependencies: z.array(InstructionDependencySchema).optional(),
})

export interface OpenSpecDriver {
  readonly newChange: (changeName: string, schema: string) => Promise<NewChangeResult>
  readonly status: (changeName: string) => Promise<StatusResult>
  readonly instructions: (artifactId: string, changeName: string) => Promise<InstructionsResult>
  readonly validateStrict: (changeName: string) => Promise<ValidateResult>
}

async function run(deps: OpenSpecDriverDeps, args: readonly string[], label: string): Promise<string> {
  const result = await deps.exec([deps.binary ?? 'openspec', ...args], { cwd: deps.cwd })
  if (result.exitCode !== 0) {
    throw new Error(`openspec ${label} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function parseJson(stdout: string, label: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch (error) {
    throw new Error(`openspec ${label}: unparseable JSON output`, { cause: error })
  }
}

export function createOpenSpecDriver(deps: OpenSpecDriverDeps): OpenSpecDriver {
  return {
    newChange: async (changeName, schema) => {
      await run(deps, ['new', 'change', changeName, '--schema', schema], 'new change')
      return { changeName }
    },
    status: async (changeName) => {
      const stdout = await run(deps, ['status', '--change', changeName, '--json'], 'status')
      const payload = StatusPayloadSchema.parse(parseJson(stdout, 'status'))
      const artifacts: Record<string, string> = {}
      for (const artifact of payload.artifacts) artifacts[artifact.id] = artifact.status
      return { schemaName: payload.schemaName, artifacts, isPlanningComplete: payload.isPlanningComplete ?? false }
    },
    instructions: async (artifactId, changeName) => {
      const stdout = await run(deps, ['instructions', artifactId, '--change', changeName, '--json'], 'instructions')
      const payload = InstructionsPayloadSchema.parse(parseJson(stdout, 'instructions'))
      return {
        instruction: payload.instruction,
        template: payload.template,
        rules: payload.rules ?? [],
        resolvedOutputPath: payload.resolvedOutputPath,
        existingOutputPaths: payload.existingOutputPaths ?? [],
        dependencies: payload.dependencies ?? [],
      }
    },
    validateStrict: async (changeName) => {
      const result = await deps.exec([deps.binary ?? 'openspec', 'validate', changeName, '--strict'], { cwd: deps.cwd })
      const output = `${result.stdout}${result.stderr}`
      return { ok: result.exitCode === 0 && output.includes('is valid'), output }
    },
  }
}
