// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type RuntimeExtensionCleanup = () => void | Promise<void>
type RuntimeExtensionNoCleanup = ReturnType<() => void>

const collectCleanupFailure = async (
  failures: readonly unknown[],
  cleanup: RuntimeExtensionCleanup,
): Promise<readonly unknown[]> => {
  try {
    await cleanup()
    return failures
  } catch (error) {
    return [...failures, error]
  }
}

const throwCleanupFailures = (failures: readonly unknown[]): void => {
  if (failures.length === 0) return
  if (failures.length === 1) throw failures[0]
  throw new AggregateError(failures, 'Multiple scenario runtime extension cleanups failed')
}

export type ScenarioRuntimeExtension = Readonly<{
  start():
    | RuntimeExtensionNoCleanup
    | RuntimeExtensionCleanup
    | Promise<RuntimeExtensionNoCleanup | RuntimeExtensionCleanup>
}>

export type ScenarioRuntimeExtensionLifecycle = Readonly<{
  hasRegistered(): boolean
  start(): Promise<void>
  stop(): Promise<void>
}>

export const createScenarioRuntimeExtensionLifecycle = (
  getExtensions: () => readonly ScenarioRuntimeExtension[],
): ScenarioRuntimeExtensionLifecycle => {
  let cleanups: readonly RuntimeExtensionCleanup[] = []
  let startInFlight: Promise<void> | undefined
  let stopInFlight: Promise<void> | undefined

  const stop = (): Promise<void> => {
    if (stopInFlight !== undefined) return stopInFlight
    stopInFlight = (async (): Promise<void> => {
      const failures = await [...cleanups]
        .reverse()
        .reduce(
          async (pending, cleanup): Promise<readonly unknown[]> => collectCleanupFailure(await pending, cleanup),
          Promise.resolve<readonly unknown[]>([]),
        )
      throwCleanupFailures(failures)
    })()
    return stopInFlight
  }

  const start = (): Promise<void> => {
    if (startInFlight !== undefined) return startInFlight
    startInFlight = (async (): Promise<void> => {
      try {
        for (const extension of getExtensions()) {
          const cleanup = await extension.start()
          if (typeof cleanup === 'function') cleanups = [...cleanups, cleanup]
        }
      } catch (error) {
        await Promise.allSettled([stop()])
        throw error
      }
    })()
    return startInFlight
  }

  return { hasRegistered: (): boolean => getExtensions().length > 0, start, stop }
}
