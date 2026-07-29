// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Renders the Gate 0 acceptance contract. Informational only: it counts and displays,
 * and never declares readiness. Enforcement lives in the criterion suites.
 */

import { CORPUS_VERSION } from './corpus.js'
import { coveredShapes } from './coverage.js'
import { type Criterion, CRITERIA, SHAPES } from './registry.js'

const CRITERION_MARKS: Readonly<Record<Criterion['status'], string>> = {
  implemented: 'x',
  'predicate-registered': '~',
  'declared-unmet': '!',
}

const criterionDetail = (criterion: Criterion): string => {
  if (criterion.status === 'implemented') return `shapes: ${coveredShapes(criterion.key).join(', ')}`
  const blocker = `blocker: ${criterion.blocker ?? ''}`
  if (criterion.status === 'declared-unmet') return blocker
  return `registered cells: ${criterion.registeredShapes.join(', ')} — ${blocker}`
}

const criterionLines = (): readonly string[] =>
  CRITERIA.map(
    (criterion) => `  [${CRITERION_MARKS[criterion.status]}] ${criterion.key.padEnd(22)} ${criterionDetail(criterion)}`,
  )

const shapeLines = (): readonly string[] =>
  SHAPES.map((shape) => {
    const mark = shape.status === 'implemented' ? 'x' : '!'
    const detail = shape.status === 'implemented' ? '' : `blocker: ${shape.blocker ?? ''}`
    return `  [${mark}] ${shape.key.padEnd(22)} ${detail}`.trimEnd()
  })

export function renderAcceptanceReport(): string {
  const implemented = CRITERIA.filter((c) => c.status === 'implemented').length
  const registered = CRITERIA.filter((c) => c.status === 'predicate-registered').length
  const unmet = CRITERIA.filter((c) => c.status === 'declared-unmet').length
  return [
    'Memory Gate 0 — production acceptance contract',
    `corpus version: ${CORPUS_VERSION}`,
    '',
    `criteria (${CRITERIA.length}):`,
    ...criterionLines(),
    '',
    `scenario shapes (${SHAPES.length}):`,
    ...shapeLines(),
    '',
    'contract versioned = YES',
    `production ready = NO (${implemented} implemented, ${registered} predicate-registered, ${unmet} unmet)`,
    '',
    'This report is informational. Criterion enforcement lives in',
    'tests/long-term-memory/acceptance/. A criterion is promoted only by satisfying a pass',
    'predicate written before its implementation began — see the design doc.',
    'A [~] criterion has a frozen predicate and no evidence: the cells it lists are promised,',
    'not executed.',
  ].join('\n')
}
