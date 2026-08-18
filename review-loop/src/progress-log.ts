// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DiffStats } from './diff-stats.js'
import type { RunStats } from './run-stats.js'
import type { Severity } from './trace-log.js'

export type IssueProgressEvent =
  | { type: 'round'; round: number; maxRounds: number }
  | { type: 'found'; id: string; severity: Severity; file: string; line: number; title: string }
  | { type: 'decided'; id: string; verdict: string; title: string; note?: string }

export interface UsageDelta {
  input: number
  output: number
  reasoning: number
  cacheRead?: number
  cacheWrite?: number
  cost: number
  label?: string
  model?: string
}

export interface ProgressReporter {
  readonly dynamic: boolean
  readonly stats?: RunStats
  event(message: string): void
  live(lines: readonly string[]): void
  clearLive(): void
  log(message: string): void
  issue?(event: IssueProgressEvent): void
  statusSuffix?(): string
  slot?(key: string, line: string | null): void
  /**
   * Freezes a slot's live line as one permanent scrolled line and frees the key.
   * `line` replaces the slot content when given. With neither slot nor line: no-op.
   * In non-dynamic mode the line (if any) is printed and slot state is ignored.
   */
  commit?(key: string, line?: string): void
  usage?(delta: UsageDelta): void
  diff?(label: string, diff: DiffStats): void
}

export function emitDecision(
  log: ProgressReporter,
  record: { id: string; issue: { title: string } },
  verdict: string,
  note?: string,
): void {
  log.issue?.({ id: record.id, title: record.issue.title, type: 'decided', verdict, note })
}
