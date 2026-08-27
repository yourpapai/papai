// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Halt carried by work modules when validation exhausts its attempts (legacy stage-machine copy; the bracket itself is loop mechanics). */
export class StageHaltError extends Error {
  constructor(
    message: string,
    readonly resumeHint?: string,
  ) {
    super(message)
    this.name = 'StageHaltError'
  }
}
