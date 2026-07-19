// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type Task<T> = () => Promise<T>

export interface AsyncMutex {
  <T>(key: string, task: Task<T>): Promise<T>
}

export function createAsyncMutex(): AsyncMutex {
  const chains = new Map<string, Promise<unknown>>()
  return function mutex<T>(key: string, task: Task<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve()
    const next = prev.then(task, task)
    chains.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }
}
