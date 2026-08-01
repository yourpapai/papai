// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Severity } from './trace-log.js'

export type IssueProgressEvent =
  | { type: 'round'; round: number; maxRounds: number }
  | { type: 'found'; id: string; severity: Severity; file: string; line: number; title: string }
  | { type: 'decided'; id: string; verdict: string; title: string; note?: string }

export interface ProgressReporter {
  readonly dynamic: boolean
  event(message: string): void
  live(lines: readonly string[]): void
  clearLive(): void
  log(message: string): void
  issue?(event: IssueProgressEvent): void
  statusSuffix?(): string
}
