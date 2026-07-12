// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type RuntimeExtensionCleanup = () => void | Promise<void>
type RuntimeExtensionNoCleanup = ReturnType<() => void>

export type ScenarioRuntimeExtension = Readonly<{
  start():
    | RuntimeExtensionNoCleanup
    | RuntimeExtensionCleanup
    | Promise<RuntimeExtensionNoCleanup | RuntimeExtensionCleanup>
}>

export type ScenarioRuntimeExtensionLifecycle = Readonly<{
  start(): Promise<void>
  stop(): Promise<void>
}>

export const createScenarioRuntimeExtensionLifecycle = (
  extensions: readonly ScenarioRuntimeExtension[],
): ScenarioRuntimeExtensionLifecycle => {
  let cleanups: readonly RuntimeExtensionCleanup[] = []
  let stopInFlight: Promise<void> | undefined

  const stop = (): Promise<void> => {
    if (stopInFlight !== undefined) return stopInFlight
    stopInFlight = (async (): Promise<void> => {
      for (const cleanup of [...cleanups].reverse()) await cleanup()
    })()
    return stopInFlight
  }

  const start = async (): Promise<void> => {
    try {
      for (const extension of extensions) {
        const cleanup = await extension.start()
        if (typeof cleanup === 'function') cleanups = [...cleanups, cleanup]
      }
    } catch (error) {
      await stop().catch((): void => undefined)
      throw error
    }
  }

  return { start, stop }
}
