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

const HEADING_RE = /^#{1,6}\s+\S/u
const CHECKBOX_RE = /^\s*-\s*\[(?<mark>[ xX])\]\s/u

const extractOutline = (files: readonly ReduceFileInput[]): string[] => {
  const outline: string[] = []
  for (const file of files) {
    if (file.text === undefined) continue
    for (const line of file.text.split('\n')) {
      const trimmed = line.trimEnd()
      if (HEADING_RE.test(trimmed)) outline.push(trimmed)
    }
  }
  return outline
}

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

const isArchived = (input: ReduceSpecInput): boolean =>
  input.changeName.startsWith('archive/') || input.files.some((f) => /(^|\/)archive\//u.test(f.path))

const deriveProgress = (files: readonly ReduceFileInput[]): { ticked: number; total: number } => {
  let ticked = 0
  let total = 0
  for (const file of files) {
    if (file.kind !== 'tasks' || file.text === undefined) continue
    const counts = countCheckboxes(file.text)
    ticked += counts.ticked
    total += counts.total
  }
  return { ticked, total }
}

const hasPlanOrDesign = (files: readonly ReduceFileInput[]): boolean =>
  files.some((f) => f.kind === 'plan' || f.kind === 'design')

/**
 * Pure mechanical derivation of a change's outline, stage, and progress from
 * its markdown files. Runs on push before raw text is discarded; only
 * `one_line`/`summary` come from the LLM (see design.md §4).
 */
export function reduceSpec(input: ReduceSpecInput): ReducedSpec {
  const outline = extractOutline(input.files)

  if (isArchived(input)) return { outline, stage: 'done', progressPct: 100 }

  const { ticked, total } = deriveProgress(input.files)
  if (total > 0) {
    const progressPct = Math.round((ticked / total) * 100)
    if (ticked === total) return { outline, stage: 'done', progressPct: 100 }
    if (ticked > 0) return { outline, stage: 'in-progress', progressPct }
    return { outline, stage: hasPlanOrDesign(input.files) ? 'approved' : 'draft', progressPct: 0 }
  }

  return { outline, stage: hasPlanOrDesign(input.files) ? 'approved' : 'draft', progressPct: 0 }
}
