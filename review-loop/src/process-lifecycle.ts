// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChildProcess } from 'node:child_process'

interface ProcessFailureWatcher {
  promise: Promise<never>
  dispose(): void
}

function createProcessFailureError(processHandle: ChildProcess, processError: Error | null): Error {
  if (processError !== null) {
    return new Error(`ACP subprocess failed: ${processError.message}`)
  }
  if (processHandle.signalCode !== null) {
    return new Error(`ACP subprocess exited with signal ${processHandle.signalCode}`)
  }
  return new Error(`ACP subprocess exited with code ${processHandle.exitCode ?? 'unknown'}`)
}

function throwIfProcessFailed(processHandle: ChildProcess, processError: Error | null): void {
  if (processError !== null || processHandle.exitCode !== null || processHandle.signalCode !== null) {
    throw createProcessFailureError(processHandle, processError)
  }
}

function watchProcessFailure(processHandle: ChildProcess, getProcessError: () => Error | null): ProcessFailureWatcher {
  let handleClose: (() => void) | null = null
  let handleError: ((error: Error) => void) | null = null
  const promise = new Promise<never>((_, reject) => {
    if (getProcessError() !== null || processHandle.exitCode !== null || processHandle.signalCode !== null) {
      reject(createProcessFailureError(processHandle, getProcessError()))
      return
    }
    handleClose = (): void => {
      reject(createProcessFailureError(processHandle, getProcessError()))
    }
    handleError = (error: Error): void => {
      reject(createProcessFailureError(processHandle, error))
    }
    processHandle.on('close', handleClose)
    processHandle.on('error', handleError)
  })
  return {
    promise,
    dispose(): void {
      if (handleClose !== null) {
        processHandle.off('close', handleClose)
      }
      if (handleError !== null) {
        processHandle.off('error', handleError)
      }
    },
  }
}

export function waitForProcessSpawn(processHandle: ChildProcess, getProcessError: () => Error | null): Promise<void> {
  if (getProcessError() !== null || processHandle.exitCode !== null || processHandle.signalCode !== null) {
    return Promise.reject(createProcessFailureError(processHandle, getProcessError()))
  }
  if (processHandle.pid !== undefined) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    const handleSpawn = (): void => {
      cleanup()
      resolve()
    }
    const handleError = (error: Error): void => {
      cleanup()
      reject(createProcessFailureError(processHandle, error))
    }
    const cleanup = (): void => {
      processHandle.off('spawn', handleSpawn)
      processHandle.off('error', handleError)
    }
    processHandle.once('spawn', handleSpawn)
    processHandle.once('error', handleError)
  })
}

export async function callConnection<T>(
  processHandle: ChildProcess,
  getProcessError: () => Error | null,
  operation: () => Promise<T>,
): Promise<T> {
  throwIfProcessFailed(processHandle, getProcessError())
  const watcher = watchProcessFailure(processHandle, getProcessError)
  try {
    const result = await Promise.race([operation(), watcher.promise])
    throwIfProcessFailed(processHandle, getProcessError())
    return result
  } catch (error) {
    const processError = getProcessError()
    if (processError !== null || processHandle.exitCode !== null || processHandle.signalCode !== null) {
      throw createProcessFailureError(processHandle, processError)
    }
    if (error instanceof Error && error.message === 'ACP connection closed') {
      await watcher.promise
    }
    throw error
  } finally {
    watcher.dispose()
  }
}
