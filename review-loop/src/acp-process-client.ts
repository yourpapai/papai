// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { spawn } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'

import * as acp from '@agentclientprotocol/sdk'

import {
  createCloseMethod,
  createInitializeMethod,
  createLoadSessionMethod,
  createNewSessionMethod,
  createPromptMethod,
  createSetConfigOptionMethod,
  createWaitForSessionUpdatesMethod,
} from './acp-connection-methods.js'
import type { PermissionRequestLike } from './permission-policy.js'
import { waitForProcessSpawn } from './process-lifecycle.js'

export interface AcpProcessSpec {
  command: string
  args: readonly string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  transcriptPath: string
  selectPermissionOptionId?: (request: PermissionRequestLike) => string
}

export interface AcpProcessClient {
  initialize(): Promise<void>
  newSession(cwd: string): Promise<{ sessionId: string }>
  loadSession(sessionId: string, cwd: string): Promise<void>
  setConfigOption(sessionId: string, configId: string, value: string): Promise<void>
  prompt(sessionId: string, text: string): Promise<{ stopReason: string }>
  onSessionUpdate(listener: (params: acp.SessionNotification) => void): void
  waitForSessionUpdates(): Promise<void>
  close(): Promise<void>
}

function findRejectOption(params: acp.RequestPermissionRequest): acp.PermissionOption | undefined {
  return (
    params.options.find((option) => option.kind === 'reject_once') ??
    params.options.find((option) => option.kind === 'reject_always')
  )
}

function createSelectedPermissionResponse(optionId: string): acp.RequestPermissionResponse {
  return {
    outcome: {
      outcome: 'selected',
      optionId,
    },
  }
}

function createPermissionInputRecord(rawInput: unknown): Record<string, unknown> {
  const inputRecord: Record<string, unknown> = {}
  if (rawInput !== null && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    for (const [key, value] of Object.entries(rawInput)) {
      inputRecord[key] = value
    }
  }
  return inputRecord
}

function resolvePermissionOptionId(spec: AcpProcessSpec, params: acp.RequestPermissionRequest): string {
  if (spec.selectPermissionOptionId === undefined) {
    throw new Error('No ACP permission handler configured')
  }

  const optionId = spec.selectPermissionOptionId({
    title: params.toolCall.title ?? '',
    kind: params.toolCall.kind ?? 'other',
    locations: (params.toolCall.locations ?? []).map((location) => ({ path: location.path })),
    rawInput: createPermissionInputRecord(params.toolCall.rawInput),
    options: params.options.map((option) => ({
      optionId: option.optionId,
      kind: option.kind,
    })),
  })

  const isKnownOption = params.options.some((option) => option.optionId === optionId)
  if (!isKnownOption) {
    throw new Error(`Permission handler returned invalid optionId "${optionId}"`)
  }

  return optionId
}

export function handlePermissionRequest(
  spec: AcpProcessSpec,
  params: acp.RequestPermissionRequest,
): acp.RequestPermissionResponse {
  const rejectOption = findRejectOption(params)

  try {
    return createSelectedPermissionResponse(resolvePermissionOptionId(spec, params))
  } catch (error) {
    if (rejectOption === undefined) {
      throw new Error('Permission request could not be resolved and no reject option was provided', {
        cause: error,
      })
    }

    return createSelectedPermissionResponse(rejectOption.optionId)
  }
}

function createRuntimeClient(
  spec: AcpProcessSpec,
  listeners: Array<(params: acp.SessionNotification) => void>,
  pendingSessionUpdates: Set<Promise<void>>,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
): acp.Client {
  let sessionUpdateQueue = Promise.resolve()

  return {
    async sessionUpdate(params: acp.SessionNotification): Promise<void> {
      const pendingUpdate = sessionUpdateQueue.then(async (): Promise<void> => {
        await appendTranscript('in', params)
        for (const listener of listeners) {
          listener(params)
        }
      })

      sessionUpdateQueue = pendingUpdate.catch((error: unknown): void => {
        void error
      })
      pendingSessionUpdates.add(pendingUpdate)
      try {
        await pendingUpdate
      } finally {
        pendingSessionUpdates.delete(pendingUpdate)
      }
    },
    requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
      return Promise.resolve(handlePermissionRequest(spec, params))
    },
  }
}

function isUint8ArrayReadableStream(stream: unknown): stream is ReadableStream<Uint8Array> {
  return stream instanceof ReadableStream
}

function createAcpStream(stdin: NodeJS.WritableStream, stdout: NodeJS.ReadableStream): acp.Stream {
  const writableStream = Writable.toWeb(stdin) as WritableStream<Uint8Array>
  const readableStream = Readable.toWeb(stdout)
  if (!isUint8ArrayReadableStream(readableStream)) {
    throw new Error('Failed to convert stdout to ReadableStream<Uint8Array>')
  }
  return acp.ndJsonStream(writableStream, readableStream)
}

export async function createAcpProcessClient(spec: AcpProcessSpec): Promise<AcpProcessClient> {
  const processHandle = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  let processError: Error | null = null
  const listeners: Array<(params: acp.SessionNotification) => void> = []
  const pendingSessionUpdates = new Set<Promise<void>>()
  processHandle.once('error', (error) => {
    processError = error instanceof Error ? error : new Error(String(error))
  })
  async function appendTranscript(direction: 'in' | 'out', payload: unknown): Promise<void> {
    await appendFile(spec.transcriptPath, `${JSON.stringify({ direction, payload })}\n`)
  }
  await waitForProcessSpawn(processHandle, () => processError)
  const runtimeClient = createRuntimeClient(spec, listeners, pendingSessionUpdates, appendTranscript)
  const stream = createAcpStream(processHandle.stdin, processHandle.stdout)
  const connection = new acp.ClientSideConnection(() => runtimeClient, stream)
  const waitForSessionUpdates = createWaitForSessionUpdatesMethod(pendingSessionUpdates)
  return {
    initialize: createInitializeMethod(connection, appendTranscript, processHandle, () => processError),
    newSession: createNewSessionMethod(connection, appendTranscript, processHandle, () => processError),
    loadSession: createLoadSessionMethod(connection, appendTranscript, processHandle, () => processError),
    setConfigOption: createSetConfigOptionMethod(connection, appendTranscript, processHandle, () => processError),
    prompt: createPromptMethod(connection, appendTranscript, processHandle, () => processError),
    onSessionUpdate(listener: (params: acp.SessionNotification) => void): void {
      listeners.push(listener)
    },
    waitForSessionUpdates,
    close: createCloseMethod(processHandle, waitForSessionUpdates),
  }
}
