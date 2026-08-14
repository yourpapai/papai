// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type SpecStage = 'draft' | 'approved' | 'in-progress' | 'done'

export interface ReduceFileInput {
  path: string
  kind: string
  text?: string
}

export interface ReduceSpecInput {
  changeName: string
  files: ReduceFileInput[]
}

export interface ReducedSpec {
  outline: string[]
  stage: SpecStage
  progressPct: number
}

export interface ReducedFileArtifacts {
  outline: string[]
  ticked: number
  total: number
}

export interface AggregateFileInput {
  path: string
  kind: string
  outline: readonly string[] | null
  ticked: number | null
  total: number | null
}

export interface AggregateSpecInput {
  changeName: string
  files: AggregateFileInput[]
}

const HEADING_RE = /^#{1,6}\s+\S/u
const CHECKBOX_RE = /^\s*-\s*\[(?<mark>[ xX])\]\s/u

const countCheckboxes = (text: string): { ticked: number; total: number } => {
  let ticked = 0
  let total = 0
  for (const line of text.split('\n')) {
    const match = CHECKBOX_RE.exec(line)
    if (match === null) continue
    total += 1
    if (match.groups?.['mark'] !== ' ') ticked += 1
  }
  return { ticked, total }
}

const isArchived = (changeName: string, files: readonly { path: string }[]): boolean =>
  changeName.startsWith('archive/') || files.some((f) => /(^|\/)archive\//u.test(f.path))

const hasPlanOrDesign = (files: readonly { kind: string }[]): boolean =>
  files.some((f) => f.kind === 'plan' || f.kind === 'design')

const deriveStageAndProgress = (
  archived: boolean,
  planOrDesign: boolean,
  ticked: number,
  total: number,
): { stage: SpecStage; progressPct: number } => {
  if (archived) return { stage: 'done', progressPct: 100 }
  if (total > 0) {
    const progressPct = Math.round((ticked / total) * 100)
    if (ticked === total) return { stage: 'done', progressPct: 100 }
    if (ticked > 0) return { stage: 'in-progress', progressPct }
    return { stage: planOrDesign ? 'approved' : 'draft', progressPct: 0 }
  }
  return { stage: planOrDesign ? 'approved' : 'draft', progressPct: 0 }
}

/**
 * Per-file mechanical derivation persisted alongside each file row on push, so
 * later delta pushes can re-aggregate the spec without the unchanged files'
 * raw text (which is never retained).
 */
export const reduceFileText = (kind: string, text: string): ReducedFileArtifacts => {
  const outline: string[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd()
    if (HEADING_RE.test(trimmed)) outline.push(trimmed)
  }
  const counts = kind === 'tasks' ? countCheckboxes(text) : { ticked: 0, total: 0 }
  return { outline, ticked: counts.ticked, total: counts.total }
}

/**
 * Re-aggregates a change's outline, stage, and progress from stored per-file
 * artifacts. Files with null artifacts (pushed without text) contribute
 * nothing, matching the whole-text reducer's skip semantics.
 */
export function aggregateSpec(input: AggregateSpecInput): ReducedSpec {
  const outline = input.files.flatMap((f) => f.outline ?? [])

  let ticked = 0
  let total = 0
  for (const file of input.files) {
    if (file.kind !== 'tasks' || file.ticked === null || file.total === null) continue
    ticked += file.ticked
    total += file.total
  }

  const derived = deriveStageAndProgress(
    isArchived(input.changeName, input.files),
    hasPlanOrDesign(input.files),
    ticked,
    total,
  )
  return { outline, ...derived }
}

/**
 * Pure mechanical derivation of a change's outline, stage, and progress from
 * its markdown files. Runs on push before raw text is discarded; only
 * `one_line`/`summary` come from the LLM (see design.md §4).
 */
export function reduceSpec(input: ReduceSpecInput): ReducedSpec {
  return aggregateSpec({
    changeName: input.changeName,
    files: input.files.map((file): AggregateFileInput => {
      if (file.text === undefined) return { path: file.path, kind: file.kind, outline: null, ticked: null, total: null }
      const artifacts = reduceFileText(file.kind, file.text)
      return {
        path: file.path,
        kind: file.kind,
        outline: artifacts.outline,
        ticked: artifacts.ticked,
        total: artifacts.total,
      }
    }),
  })
}
