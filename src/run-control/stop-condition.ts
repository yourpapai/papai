// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunControl } from './types.js'

/**
 * A stopWhen condition that ends the loop after the current step when a deterministic
 * stop was requested. Assignable to the AI SDK StopCondition (sync boolean is allowed).
 */
export function createStopRequestedCondition(run: RunControl): () => boolean {
  return () => run.stopRequested
}
