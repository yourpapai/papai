// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import type { RepoEntry } from '../../context-vault-indexer/config.js'
import {
  handleIpcLine,
  MAX_REQUEST_BYTES,
  sendIpcRequest,
  startIpcServer,
  type IpcHandler,
  type IpcServer,
  type IpcServerFs,
} from '../../context-vault-indexer/ipc.js'
import type { RegisterResult } from '../../context-vault-indexer/registry.js'

type FakeHandler = IpcHandler & { calls: RepoEntry[] }

const makeHandler = (result: RegisterResult = { ok: true, repo: 'papai', action: 'registered' }): FakeHandler => {
  const calls: RepoEntry[] = []
  return {
    calls,
    register: (input: RepoEntry) => {
      calls.push(input)
      return result
    },
    status: () => ({ repos: [{ repo: 'papai', specDir: '/repo/openspec/changes' }], lastScanAt: 1_700_000_000_000 }),
  }
}

const ResponseSchema = z.record(z.string(), z.unknown())

const parse = (line: string): Record<string, unknown> => ResponseSchema.parse(JSON.parse(line))

const asResponse = (value: unknown): Record<string, unknown> => ResponseSchema.parse(value)

describe('handleIpcLine', () => {
  test('registers and echoes the action', () => {
    const handler = makeHandler()

    const response = parse(
      handleIpcLine(JSON.stringify({ op: 'register', repo: 'papai', specDir: '/repo/openspec/changes' }), handler),
    )

    expect(response).toEqual({ ok: true, repo: 'papai', action: 'registered' })
    expect(handler.calls).toEqual([{ repo: 'papai', specDir: '/repo/openspec/changes' }])
  })

  test('relays a registration rejection without mutating anything', () => {
    const handler = makeHandler({ ok: false, error: 'Spec directory does not exist: /nope' })

    const response = parse(handleIpcLine(JSON.stringify({ op: 'register', repo: 'papai', specDir: '/nope' }), handler))

    expect(response['ok']).toBe(false)
    expect(response['error']).toContain('/nope')
  })

  test('reports status with the repo set and last scan time', () => {
    const response = parse(handleIpcLine(JSON.stringify({ op: 'status' }), makeHandler()))

    expect(response['ok']).toBe(true)
    expect(response['repos']).toEqual([{ repo: 'papai', specDir: '/repo/openspec/changes' }])
    expect(response['lastScanAt']).toBe(1_700_000_000_000)
  })

  test('rejects an unknown op without touching the handler', () => {
    const handler = makeHandler()

    const response = parse(handleIpcLine(JSON.stringify({ op: 'drop-everything' }), handler))

    expect(response['ok']).toBe(false)
    expect(handler.calls).toEqual([])
  })

  test('rejects a malformed body', () => {
    const handler = makeHandler()

    expect(parse(handleIpcLine('{not json', handler))['ok']).toBe(false)
    expect(parse(handleIpcLine(JSON.stringify({ op: 'register', repo: 'papai' }), handler))['ok']).toBe(false)
    expect(parse(handleIpcLine(JSON.stringify({ op: 'register', repo: '', specDir: '/x' }), handler))['ok']).toBe(false)
    expect(handler.calls).toEqual([])
  })

  test('rejects a body over the size cap without parsing it', () => {
    const handler = makeHandler()
    const oversized = JSON.stringify({
      op: 'register',
      repo: 'papai',
      specDir: `/${'x'.repeat(MAX_REQUEST_BYTES)}`,
    })

    const response = parse(handleIpcLine(oversized, handler))

    expect(response['ok']).toBe(false)
    expect(handler.calls).toEqual([])
  })

  test('never emits a trailing newline inside the response line', () => {
    const response = handleIpcLine(JSON.stringify({ op: 'status' }), makeHandler())

    expect(response).not.toContain('\n')
  })
})

describe('startIpcServer', () => {
  const dirs: string[] = []
  const servers: IpcServer[] = []

  const makeDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cv-ipc-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const server of servers.splice(0)) server.close()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  const start = async (socketPath: string, handler: IpcHandler, fs?: IpcServerFs): Promise<IpcServer> => {
    const server = await startIpcServer(socketPath, handler, fs)
    servers.push(server)
    return server
  }

  test('round-trips a register request over a real unix socket', async () => {
    const socketPath = join(makeDir(), 'indexer.sock')
    const handler = makeHandler()
    await start(socketPath, handler)

    const response = await sendIpcRequest(socketPath, {
      op: 'register',
      repo: 'papai',
      specDir: '/repo/openspec/changes',
    })

    expect(response).toEqual({ ok: true, repo: 'papai', action: 'registered' })
    expect(handler.calls).toHaveLength(1)
  })

  test('keeps serving after a malformed request', async () => {
    const socketPath = join(makeDir(), 'indexer.sock')
    await start(socketPath, makeHandler())

    const bad = asResponse(await sendIpcRequest(socketPath, { op: 'nope' }))
    const good = asResponse(await sendIpcRequest(socketPath, { op: 'status' }))

    expect(bad['ok']).toBe(false)
    expect(good['ok']).toBe(true)
  })

  test('restricts the socket to the owner', async () => {
    const socketPath = join(makeDir(), 'indexer.sock')

    await start(socketPath, makeHandler())

    expect(statSync(socketPath).mode & 0o777).toBe(0o600)
  })

  test('removes a stale socket file left by a dead daemon before binding', async () => {
    const socketPath = join(makeDir(), 'indexer.sock')
    writeFileSync(socketPath, 'stale')

    await start(socketPath, makeHandler())

    const response = asResponse(await sendIpcRequest(socketPath, { op: 'status' }))
    expect(response['ok']).toBe(true)
  })

  test('closing the server removes its socket file', async () => {
    const socketPath = join(makeDir(), 'indexer.sock')
    const server = await start(socketPath, makeHandler())

    server.close()

    expect(() => statSync(socketPath)).toThrow()
  })

  test('sendIpcRequest rejects when no daemon is listening', async () => {
    const socketPath = join(makeDir(), 'absent.sock')

    await expect(sendIpcRequest(socketPath, { op: 'status' })).rejects.toThrow()
  })
})
