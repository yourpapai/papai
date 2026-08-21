// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile as readFileNode, writeFile as writeFileNode } from 'node:fs/promises'
import { resolve as pathResolve } from 'node:path'

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
  /**
   * File seam for the one metadata write the driver owns (design D2 of
   * opencode-agent-skip-specs-depth): patching `skip_specs: true` into the
   * scaffolded `.openspec.yaml`. Optional with a `node:fs` default so the
   * production wiring in `deps.ts` stays one line.
   */
  readonly readFile?: (filePath: string) => Promise<string>
  readonly writeFile?: (filePath: string, content: string) => Promise<void>
}

export interface NewChangeResult {
  readonly changeName: string
}

/**
 * The metadata `newChange` may stamp onto the scaffold (design D2 of
 * opencode-agent-skip-specs-depth).
 *
 * `skipSpecs` comes from the zod-validated triage output — never from a
 * freeform model write — and is patched into the change's `.openspec.yaml`
 * immediately after the CLI scaffold, so the next `openspec status` already
 * reports `specs: skipped` and the planning turn never drafts deltas for a
 * fix-class change.
 */
export interface NewChangeOptions {
  readonly skipSpecs?: boolean
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
  /**
   * The name of every change the resolved OpenSpec root already holds.
   *
   * `openspec new change` refuses a name that is taken, and the refusal is an
   * exit 1 the driver turns into a thrown error — which is the whole of run
   * 31929516607: triage named `prompt-injection-defense`, a change the base
   * branch has carried for weeks, and the pipeline died at INIT_OR_CLARIFY
   * rather than picking the folder up. Asking first is what lets capture decide
   * between creating and adopting instead of finding out by failing.
   */
  readonly listChangeNames: () => Promise<readonly string[]>
  readonly newChange: (changeName: string, schema: string, options?: NewChangeOptions) => Promise<NewChangeResult>
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

/**
 * `openspec list --changes --json` carries a per-change progress summary; the
 * name is the only field capture has a question about, so it is the only one
 * decoded. The rest is stripped rather than rejected, the way every payload
 * here is: a CLI that grows a field must not fail a caller that never read it.
 */
const ListPayloadSchema = z.object({
  changes: z.array(z.object({ name: z.string().min(1) })).optional(),
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

/**
 * Patches `skip_specs: true` into a scaffolded `.openspec.yaml`.
 *
 * A line-level edit rather than a yaml round-trip: the CLI's own keys are kept
 * byte-for-byte, the flag is one more `key: value` line the CLI itself writes
 * when a human sets it, and a structured parser would reorder comments and
 * quoting the scaffold never asked to have reordered. Idempotent — a file that
 * already carries the key is returned unchanged.
 */
const withSkipSpecs = (yaml: string): string => {
  if (/^skip_specs:\s*true\s*$/mu.test(yaml)) return yaml
  const body = yaml.endsWith('\n') ? yaml : `${yaml}\n`
  return `${body}skip_specs: true\n`
}

/**
 * The design D2 metadata write: deterministic TypeScript patching CLI-scaffolded
 * metadata from a validated structured decision. The model's diff-guard scope
 * never includes `.openspec.yaml` — this is the single-sourced channel for the
 * flag.
 */
const stampSkipSpecs = async (deps: OpenSpecDriverDeps, changeName: string): Promise<void> => {
  const read: (filePath: string) => Promise<string> =
    deps.readFile ?? ((filePath: string) => readFileNode(filePath, 'utf8'))
  const write: (filePath: string, content: string) => Promise<void> =
    deps.writeFile ?? ((filePath: string, content: string) => writeFileNode(filePath, content, 'utf8'))
  const yamlPath = pathResolve(deps.cwd, 'openspec', 'changes', changeName, '.openspec.yaml')
  try {
    const scaffolded = await read(yamlPath)
    await write(yamlPath, withSkipSpecs(scaffolded))
  } catch (error) {
    throw new Error(
      `openspec new change: cannot set skip_specs in .openspec.yaml for '${changeName}': ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    )
  }
}

/** The artifact map behind `status`, decoded from the CLI's array of records. */
const readStatus = async (deps: OpenSpecDriverDeps, changeName: string): Promise<StatusResult> => {
  const stdout = await runExpectOk(deps, ['status', '--change', changeName, '--json'], 'status')
  const payload = StatusPayloadSchema.parse(parseJson(stdout, 'status'))
  const artifacts: Record<string, string> = {}
  for (const artifact of payload.artifacts) artifacts[artifact.id] = artifact.status
  return { schemaName: payload.schemaName, artifacts, isPlanningComplete: payload.isPlanningComplete ?? false }
}

/** One artifact's enriched instruction, with every optional field defaulted. */
const readInstructions = async (
  deps: OpenSpecDriverDeps,
  artifactId: string,
  changeName: string,
): Promise<InstructionsResult> => {
  const stdout = await runExpectOk(deps, ['instructions', artifactId, '--change', changeName, '--json'], 'instructions')
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
}

export function createOpenSpecDriver(deps: OpenSpecDriverDeps): OpenSpecDriver {
  return {
    listChangeNames: async () => {
      const stdout = await runExpectOk(deps, ['list', '--changes', '--json'], 'list')
      const payload = ListPayloadSchema.parse(parseJson(stdout, 'list'))
      return (payload.changes ?? []).map((change) => change.name)
    },

    newChange: async (changeName, schema, options) => {
      await runExpectOk(deps, ['new', 'change', changeName, '--schema', schema], 'new change')
      if (options?.skipSpecs === true) await stampSkipSpecs(deps, changeName)
      return { changeName }
    },

    status: (changeName) => readStatus(deps, changeName),

    instructions: (artifactId, changeName) => readInstructions(deps, artifactId, changeName),

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
