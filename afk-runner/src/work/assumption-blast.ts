// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * R3 classification input: a gate assumption in sidecar shape. `evidence`
 * absent (or its `files` empty/un-recordable) means the sidecar entry lacked
 * verifiable evidence or the sidecar failed to parse — fail closed
 * (high-blast). `blast_radius` is the agent's free text, display-only.
 */
export interface ClassifiableAssumption {
  readonly id: string
  readonly text: string
  readonly blast_radius: string
  readonly evidence?: { readonly files: readonly string[] }
}

export interface ClassifiedAssumption {
  readonly id: string
  readonly text: string
  readonly blastRadius: string
  readonly blast: 'low' | 'high'
  readonly files: readonly string[]
}

export interface ClassifyContext {
  /** Repo-relative change folder path, e.g. `openspec/changes/<name>`. */
  readonly changeDir: string
  /** Repo-relative run dir path, e.g. `.sdd-runner/runs/<id>`. */
  readonly runDir: string
  /** Repo-relative paths the pipeline itself recorded (artifact/materialize events). */
  readonly recordedPaths: readonly string[]
}

function startsWithDir(repoRelative: string, dir: string): boolean {
  if (repoRelative === dir) return true
  return repoRelative.startsWith(`${dir}/`)
}

function isInsideBoundaries(file: string, ctx: ClassifyContext): boolean {
  return startsWithDir(file, ctx.changeDir) || startsWithDir(file, ctx.runDir)
}

function isSpecDelta(file: string, ctx: ClassifyContext): boolean {
  return startsWithDir(file, `${ctx.changeDir}/specs`) && file.endsWith('spec.md')
}

function isTasksChecklist(file: string, ctx: ClassifyContext): boolean {
  return file === `${ctx.changeDir}/tasks.md`
}

/**
 * R3 blast-radius triage — pure arithmetic over recorded run artifacts. An
 * assumption is low-blast iff it carries a non-empty `evidence.files` list
 * whose every entry is inside the change folder or run dir, was recorded by
 * the pipeline itself, touches no spec delta and no tasks checkbox line.
 * Everything else — including missing, empty, or un-cross-checkable evidence
 * and unparseable sidecars — is high-blast: fail closed, never vacuously
 * low-blast. The agent-emitted `blast_radius` text is display-only and never
 * consulted.
 */
export function classifyAssumptions(
  assumptions: readonly ClassifiableAssumption[],
  ctx: ClassifyContext,
): readonly ClassifiedAssumption[] {
  const recorded = new Set(ctx.recordedPaths)
  return assumptions.map((assumption) => {
    const files = assumption.evidence?.files ?? null
    const lowBlast =
      files !== null &&
      files.length > 0 &&
      files.every(
        (file) =>
          recorded.has(file) &&
          isInsideBoundaries(file, ctx) &&
          !isSpecDelta(file, ctx) &&
          !isTasksChecklist(file, ctx),
      )
    return {
      id: assumption.id,
      text: assumption.text,
      blastRadius: assumption.blast_radius,
      blast: lowBlast ? ('low' as const) : ('high' as const),
      files: files ?? [],
    }
  })
}
