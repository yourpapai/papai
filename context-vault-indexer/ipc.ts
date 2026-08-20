// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { chmodSync, rmSync } from 'node:fs'

import { z } from 'zod'

import type { RepoEntry } from './config.js'
import type { RegisterResult } from './registry.js'

export const SOCKET_FILE_NAME = 'context-vault-indexer.sock'

/** Same discipline as the push route: cap first, parse second. */
export const MAX_REQUEST_BYTES = 64 * 1024

const SOCKET_MODE = 0o600

export const socketPathOf = (stateDir: string): string => `${stateDir}/${SOCKET_FILE_NAME}`

const RequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('register'), repo: z.string().min(1), specDir: z.string().min(1) }),
  z.object({ op: z.literal('status') }),
])

export type IpcHandler = {
  register(input: RepoEntry): RegisterResult
  status(): { repos: RepoEntry[]; lastScanAt: number | null }
}

const errorLine = (error: string): string => JSON.stringify({ ok: false, error })

/**
 * Pure request→response mapping for one newline-delimited JSON line. Every
 * rejection path leaves the handler untouched, so a malformed or oversized
 * request can never move daemon state.
 */
export function handleIpcLine(line: string, handler: IpcHandler): string {
  if (Buffer.byteLength(line, 'utf8') > MAX_REQUEST_BYTES) return errorLine('request too large')

  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return errorLine('invalid JSON request')
  }

  const request = RequestSchema.safeParse(parsed)
  if (!request.success) return errorLine('invalid request')

  if (request.data.op === 'status') {
    const status = handler.status()
    return JSON.stringify({ ok: true, repos: status.repos, lastScanAt: status.lastScanAt })
  }
  return JSON.stringify(handler.register({ repo: request.data.repo, specDir: request.data.specDir }))
}

export type IpcServerFs = {
  removeIfExists(path: string): void
  chmod(path: string, mode: number): void
}

const defaultServerFs: IpcServerFs = {
  removeIfExists: (path: string) => {
    rmSync(path, { force: true })
  },
  chmod: (path: string, mode: number) => {
    chmodSync(path, mode)
  },
}

export type IpcServer = { close(): void }

/**
 * Binds the registration socket.
 *
 * Call only once the singleton lock is held: the stale-socket removal below is
 * safe precisely because the lock proves no live daemon owns this path.
 *
 * Bun creates the socket file 0755, so the chmod is load-bearing rather than
 * defensive; `stateDir` is created 0700 by the entrypoint, which closes the
 * window between bind and chmod.
 */
export function startIpcServer(
  socketPath: string,
  handler: IpcHandler,
  fs: IpcServerFs = defaultServerFs,
): Promise<IpcServer> {
  fs.removeIfExists(socketPath)
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      data(socket, data) {
        for (const line of data.toString().split('\n')) {
          if (line.trim() === '') continue
          socket.write(`${handleIpcLine(line, handler)}\n`)
        }
      },
    },
  })
  fs.chmod(socketPath, SOCKET_MODE)
  return Promise.resolve({
    close: () => {
      // Force-close live connections: a lingering client keeps Bun's event loop
      // alive, which would make the daemon ignore SIGTERM.
      server.stop(true)
      fs.removeIfExists(socketPath)
    },
  })
}

/**
 * One-shot client: connect, send a single request, resolve its response line.
 * Rejects when nothing is listening, which is how the adapter learns to retry.
 */
export function sendIpcRequest(socketPath: string, request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      action()
    }
    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) {
          socket.write(`${JSON.stringify(request)}\n`)
        },
        data(socket, data) {
          const line = data.toString().split('\n')[0] ?? ''
          // Settle before ending: `socket.end()` fires `close` synchronously,
          // which would otherwise reject the response we just read.
          finish(() => {
            try {
              resolve(JSON.parse(line))
            } catch {
              reject(new Error('daemon returned an unparseable response'))
            }
          })
          socket.end()
        },
        error(_socket, error) {
          finish(() => {
            reject(error)
          })
        },
        close() {
          finish(() => {
            reject(new Error('daemon closed the connection without responding'))
          })
        },
      },
    }).catch((error: unknown) => {
      finish(() => {
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  })
}
