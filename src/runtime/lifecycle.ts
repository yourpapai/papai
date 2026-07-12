// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface RuntimeLifecycle {
  add(name: string, cleanup: () => void | Promise<void>, priority?: number): void
  stop(): Promise<void>
  pending(): readonly string[]
}

type CleanupEntry = Readonly<{
  name: string
  cleanup: () => void | Promise<void>
  priority: number
  registrationIndex: number
}>

function inCleanupOrder(entries: readonly CleanupEntry[]): CleanupEntry[] {
  return entries.toSorted(
    (left, right) => right.priority - left.priority || right.registrationIndex - left.registrationIndex,
  )
}

async function cleanupFailure(entry: CleanupEntry): Promise<string | undefined> {
  try {
    await entry.cleanup()
    return undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `${entry.name}: ${message}`
  }
}

async function runCleanups(entries: readonly CleanupEntry[]): Promise<void> {
  const failures = await entries.reduce<Promise<readonly string[]>>(async (previous, entry) => {
    const previousFailures = await previous
    const failure = await cleanupFailure(entry)
    return failure === undefined ? previousFailures : [...previousFailures, failure]
  }, Promise.resolve([]))

  if (failures.length > 0) throw new Error(`Runtime cleanup failed: ${failures.join('; ')}`)
}

export function createRuntimeLifecycle(): RuntimeLifecycle {
  let nextRegistrationIndex = 0
  let entries: readonly CleanupEntry[] = []
  let stopInFlight: Promise<void> | undefined

  return {
    add(name, cleanup, priority = 0): void {
      entries = [...entries, { name, cleanup, priority, registrationIndex: nextRegistrationIndex }]
      nextRegistrationIndex += 1
    },
    stop(): Promise<void> {
      if (stopInFlight !== undefined) return stopInFlight

      const pendingEntries = inCleanupOrder(entries)
      entries = []
      const stopPromise = runCleanups(pendingEntries)
      stopInFlight = stopPromise

      const clearInFlight = (): void => {
        if (stopInFlight === stopPromise) stopInFlight = undefined
      }
      void stopPromise.then(clearInFlight, clearInFlight)

      return stopPromise
    },
    pending(): readonly string[] {
      return inCleanupOrder(entries).map((entry) => entry.name)
    },
  }
}
