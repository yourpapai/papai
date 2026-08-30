// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Finding } from './agent-layer.js'

export interface ArtifactFile {
  readonly path: string
  readonly content: string
}

interface TermRender {
  readonly file: string
  readonly value: string
  readonly quote: string
}

const STRATEGY_WORD = /(drizzle|prisma|knex|hand-written|handwritten|hand-rolled)/iu
const INTERVAL_LITERAL = /(\d+)\s*\*\s*60\s*\*\s*1000/gu
const BACKTICKED_IDENTIFIER = /`([^`\s]+)`/gu
const IDENTIFIER_SHAPE = /^[a-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*$/u

function normalizeStrategy(word: string): string {
  const lower = word.toLowerCase()
  return lower === 'handwritten' || lower === 'hand-rolled' ? 'hand-written' : lower
}

function firstQuotePerValue(renders: readonly TermRender[]): Map<string, TermRender> {
  const byValue = new Map<string, TermRender>()
  for (const render of renders) if (!byValue.has(render.value)) byValue.set(render.value, render)
  return byValue
}

function disagreement(
  kind: string,
  renders: readonly TermRender[],
): { readonly kind: string; readonly renders: readonly TermRender[] } | null {
  const crossFile = new Set(renders.map((render) => render.file)).size >= 2
  const distinct = firstQuotePerValue(renders)
  if (!crossFile || distinct.size < 2) return null
  return { kind, renders: [...distinct.values()] }
}

function renderLines(entries: readonly TermRender[]): string {
  return entries.map((render) => `${render.file}: '${render.quote}'`).join(' vs ')
}

function strategyRenders(files: readonly ArtifactFile[]): TermRender[] {
  const renders: TermRender[] = []
  for (const file of files) {
    for (const line of file.content.split('\n')) {
      if (!/\bmigrations?\b/iu.test(line)) continue
      const match = STRATEGY_WORD.exec(line)
      if (match === null) continue
      renders.push({ file: file.path, value: normalizeStrategy(match[0]), quote: line.trim() })
    }
  }
  return renders
}

function intervalRenders(files: readonly ArtifactFile[]): TermRender[] {
  const renders: TermRender[] = []
  for (const file of files) {
    for (const line of file.content.split('\n')) {
      for (const match of line.matchAll(INTERVAL_LITERAL)) {
        renders.push({ file: file.path, value: match[0].replace(/\s+/gu, ''), quote: line.trim() })
      }
    }
  }
  return renders
}

function tableNameRenders(files: readonly ArtifactFile[]): TermRender[] {
  const perFile = new Map<string, Map<string, TermRender>>()
  for (const file of files) {
    const seen = perFile.get(file.path) ?? new Map<string, TermRender>()
    for (const match of file.content.matchAll(BACKTICKED_IDENTIFIER)) {
      const token = match[1]!
      if (!IDENTIFIER_SHAPE.test(token)) continue
      if (!seen.has(token)) seen.set(token, { file: file.path, value: token, quote: token })
    }
    perFile.set(file.path, seen)
  }
  const byNormalized = new Map<string, TermRender[]>()
  for (const seen of perFile.values()) {
    for (const render of seen.values()) {
      const key = render.value.toLowerCase().replaceAll('_', '')
      const bucket = byNormalized.get(key) ?? []
      bucket.push(render)
      byNormalized.set(key, bucket)
    }
  }
  const renders: TermRender[] = []
  for (const bucket of byNormalized.values()) {
    const filesHaving = new Set(bucket.map((render) => render.file))
    if (filesHaving.size >= 2 && new Set(bucket.map((render) => render.value)).size >= 2) {
      renders.push(...bucket)
    }
  }
  return renders
}

/**
 * Deterministic cross-artifact consistency scan (loop-memory D6): seeded
 * decision-term vocabulary (migration strategy, interval literals, backticked
 * table/column identifiers) whose renderings disagree across artifacts become
 * synthesized MATERIAL findings naming both files and both renderings — no
 * spawn, no tokens. Generality is deliberately seeded; widening is
 * analyzer-driven.
 */
export function consistencyFindings(files: readonly ArtifactFile[]): Finding[] {
  const disagreements = [
    disagreement('migration strategy', strategyRenders(files)),
    disagreement('recompute interval', intervalRenders(files)),
    disagreement('table/column naming', tableNameRenders(files)),
  ].filter((entry): entry is { kind: string; renders: readonly TermRender[] } => entry !== null)
  return disagreements.map((entry, index) => ({
    id: `C${index + 1}`,
    class: 'MATERIAL',
    gap: `Consistency: ${entry.kind} rendered differently across artifacts — ${renderLines(entry.renders)}`,
    question: `Which rendering of the ${entry.kind} is authoritative?`,
    code_evidence_attempted: `seeded consistency scan over ${files.map((file) => file.path).join(', ')}`,
  }))
}
