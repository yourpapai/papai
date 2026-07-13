// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function trackSchedulerExecution(
  execution: Promise<void>,
  activeExecutions: Set<Promise<void>> | undefined,
): Promise<void> {
  activeExecutions?.add(execution)
  void execution.then(
    (): void => {
      activeExecutions?.delete(execution)
    },
    (): void => {
      activeExecutions?.delete(execution)
    },
  )
  return execution
}
