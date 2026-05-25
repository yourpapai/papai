// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChildProcess } from 'node:child_process'

import * as acp from '@agentclientprotocol/sdk'

import { callConnection } from './process-lifecycle.js'

const FORCE_KILL_DELAY_MS = 100
const SHUTDOWN_TIMEOUT_MS = 1000

export function createInitializeMethod(
  connection: acp.ClientSideConnection,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
  processHandle: ChildProcess,
  getProcessError: () => Error | null,
): () => Promise<void> {
  return () =>
    callConnection(processHandle, getProcessError, async () => {
      await appendTranscript('out', { method: 'initialize' })
      await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
    })
}

export function createNewSessionMethod(
  connection: acp.ClientSideConnection,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
  processHandle: ChildProcess,
  getProcessError: () => Error | null,
): (cwd: string) => Promise<{ sessionId: string }> {
  return (cwd) =>
    callConnection(processHandle, getProcessError, async () => {
      await appendTranscript('out', { method: 'session/new', cwd })
      return connection.newSession({ cwd, mcpServers: [] })
    })
}

export function createLoadSessionMethod(
  connection: acp.ClientSideConnection,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
  processHandle: ChildProcess,
  getProcessError: () => Error | null,
): (sessionId: string, cwd: string) => Promise<void> {
  return (sessionId, cwd) =>
    callConnection(processHandle, getProcessError, async () => {
      await appendTranscript('out', { method: 'session/load', sessionId, cwd })
      await connection.loadSession({ sessionId, cwd, mcpServers: [] })
    })
}

export function createSetConfigOptionMethod(
  connection: acp.ClientSideConnection,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
  processHandle: ChildProcess,
  getProcessError: () => Error | null,
): (sessionId: string, configId: string, value: string) => Promise<void> {
  return (sessionId, configId, value) =>
    callConnection(processHandle, getProcessError, async () => {
      await appendTranscript('out', {
        method: 'session/set_config_option',
        sessionId,
        configId,
        value,
      })
      await connection.setSessionConfigOption({ sessionId, configId, value })
    })
}

export function createPromptMethod(
  connection: acp.ClientSideConnection,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
  processHandle: ChildProcess,
  getProcessError: () => Error | null,
): (sessionId: string, text: string) => Promise<{ stopReason: string }> {
  return (sessionId, text) =>
    callConnection(processHandle, getProcessError, async () => {
      await appendTranscript('out', { method: 'session/prompt', sessionId, text })
      return connection.prompt({ sessionId, prompt: [{ type: 'text', text }] })
    })
}

export function createWaitForSessionUpdatesMethod(pendingSessionUpdates: Set<Promise<void>>): () => Promise<void> {
  async function drainPendingSessionUpdates(): Promise<void> {
    if (pendingSessionUpdates.size === 0) {
      return
    }
    await Promise.all([...pendingSessionUpdates])
    await drainPendingSessionUpdates()
  }
  return drainPendingSessionUpdates
}

export function createCloseMethod(
  processHandle: ChildProcess,
  waitForSessionUpdates: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      await new Promise<void>((resolve, reject) => {
        const handleClose = (): void => {
          cleanup()
          resolve()
        }
        const cleanup = (): void => {
          clearTimeout(forceKillTimeout)
          clearTimeout(shutdownTimeout)
          processHandle.off('close', handleClose)
        }
        const forceKillTimeout = setTimeout(() => {
          if (processHandle.exitCode === null && processHandle.signalCode === null) {
            processHandle.kill('SIGKILL')
          }
        }, FORCE_KILL_DELAY_MS)
        const shutdownTimeout = setTimeout(() => {
          cleanup()
          reject(new Error('ACP subprocess did not exit cleanly during shutdown'))
        }, SHUTDOWN_TIMEOUT_MS)
        processHandle.once('close', handleClose)
        const killed = processHandle.kill()
        if (!killed && (processHandle.exitCode !== null || processHandle.signalCode !== null)) {
          cleanup()
          resolve()
        }
      })
    }
    await waitForSessionUpdates()
  }
}
