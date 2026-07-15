// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface ProgressLog {
  log(message: string): void
}

export interface ProgressReporter {
  readonly dynamic: boolean
  event(message: string): void
  live(line: string): void
  clearLive(): void
  log(message: string): void
}
