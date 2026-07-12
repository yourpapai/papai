// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mock } from 'bun:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import type { ScenarioEvents } from './events.js'
import { assertGuardedWritePath, type FilesystemBoundary, installFilesystemGuard } from './io-guard-filesystem.js'
import { installTimerGuard, type InstalledTimerGuard } from './io-guard-timers.js'
import type { StrictHttpDispatcher } from './strict-http.js'

type BoundaryBindings = Readonly<{
  events: ScenarioEvents
  http: StrictHttpDispatcher
}>

type TimerHandle = unknown
type ProcessListener = CallableFunction
type ListenerRecord = Readonly<{ event: string | symbol; listener: ProcessListener; original: ProcessListener }>

type Boundary = FilesystemBoundary & {
  readonly name: string
  readonly tempRoot: string
  readonly env: Readonly<Record<string, string>>
  readonly timers: Set<TimerHandle>
  readonly listeners: Set<ListenerRecord>
  readonly servers: Set<unknown>
  readonly sockets: Set<unknown>
  readonly subprocesses: Set<unknown>
  bindings: BoundaryBindings | undefined
  allowCleanup: boolean
}

export type IoGuardSession = Readonly<{
  tempRoot: string
  bind(bindings: BoundaryBindings): void
  verify(): void
}>

const storage = new AsyncLocalStorage<Boundary>()
let installed = false
let timerGuard: InstalledTimerGuard | undefined

const PROCESS_LISTENER_METHODS = [
  'on',
  'addListener',
  'once',
  'prependListener',
  'prependOnceListener',
  'removeListener',
  'off',
  'removeAllListeners',
] as const

const processMethodDescriptors = new Map(
  PROCESS_LISTENER_METHODS.map((name) => [name, Object.getOwnPropertyDescriptor(process, name)] as const),
)

const processMethods = {
  on: process.on.bind(process),
  addListener: process.addListener.bind(process),
  prependListener: process.prependListener.bind(process),
  removeListener: process.removeListener.bind(process),
  off: process.off.bind(process),
  removeAllListeners: process.removeAllListeners.bind(process),
}

const originals = {
  fetch: globalThis.fetch,
  bunSpawn: Bun.spawn,
  bunSpawnSync: Bun.spawnSync,
  bunServe: Bun.serve,
  bunWrite: Bun.write,
  fsMkdtempSync: fs.mkdtempSync,
  fsRealpathSync: fs.realpathSync,
  fsRmSync: fs.rmSync,
  fsCloseSync: fs.closeSync,
  serverListenDescriptor: Object.getOwnPropertyDescriptor(net.Server.prototype, 'listen'),
  socketConnectDescriptor: Object.getOwnPropertyDescriptor(net.Socket.prototype, 'connect'),
}

function active(operation: string): Boundary {
  const boundary = storage.getStore()
  if (boundary === undefined) throw new Error(`Hermetic I/O violation outside an active scenario: ${operation}`)
  return boundary
}

function diagnostic(boundary: Boundary, operation: string): Error {
  const phase = boundary.bindings?.events.currentPhase() ?? 'scenario.setup'
  return new Error(`Hermetic I/O violation: scenario="${boundary.name}" phase="${phase}" operation="${operation}"`)
}

function deny(operation: string): never {
  throw diagnostic(active(operation), operation)
}

const invoke = (fn: CallableFunction, args: readonly unknown[]): unknown => Reflect.apply(fn, undefined, args)

function bunWriteTarget(value: unknown): unknown {
  if (typeof value === 'string' || value instanceof URL) return value
  if (value instanceof Blob) return Reflect.get(value, 'name') as unknown
  return value
}

function installProcessListenerTracking(): void {
  const add =
    (method: CallableFunction, once: boolean) =>
    (event: unknown, listener: unknown, ...args: unknown[]): unknown => {
      if ((typeof event !== 'string' && typeof event !== 'symbol') || typeof listener !== 'function') {
        return invoke(method, [event, listener, ...args])
      }
      const boundary = storage.getStore()
      if (boundary === undefined) return invoke(method, [event, listener, ...args])
      if (!once) {
        boundary.listeners.add({ event, listener, original: listener })
        return invoke(method, [event, listener, ...args])
      }
      let record: ListenerRecord
      const wrapped = (...listenerArgs: unknown[]): unknown => {
        invoke(processMethods.removeListener, [event, wrapped])
        boundary.listeners.delete(record)
        return Reflect.apply(listener, process, listenerArgs)
      }
      Reflect.set(wrapped, 'listener', listener)
      record = { event, listener: wrapped, original: listener }
      boundary.listeners.add(record)
      return invoke(method, [event, wrapped, ...args])
    }
  const remove =
    (method: CallableFunction) =>
    (event: unknown, listener: unknown, ...args: unknown[]): unknown => {
      const boundary = storage.getStore()
      const record = [...(boundary?.listeners ?? [])]
        .reverse()
        .find(
          (candidate) =>
            candidate.event === event && (candidate.listener === listener || candidate.original === listener),
        )
      const result = invoke(method, [event, record?.listener ?? listener, ...args])
      if (record !== undefined) boundary?.listeners.delete(record)
      return result
    }
  Reflect.set(process, 'on', add(processMethods.on, false))
  Reflect.set(process, 'addListener', add(processMethods.addListener, false))
  Reflect.set(process, 'once', add(processMethods.on, true))
  Reflect.set(process, 'prependListener', add(processMethods.prependListener, false))
  Reflect.set(process, 'prependOnceListener', add(processMethods.prependListener, true))
  Reflect.set(process, 'removeListener', remove(processMethods.removeListener))
  Reflect.set(process, 'off', remove(processMethods.off))
  Reflect.set(process, 'removeAllListeners', (event?: string | symbol): unknown => {
    const result = event === undefined ? processMethods.removeAllListeners() : processMethods.removeAllListeners(event)
    const boundary = storage.getStore()
    if (boundary !== undefined) {
      for (const record of boundary.listeners) {
        if (event === undefined || record.event === event) boundary.listeners.delete(record)
      }
    }
    return result
  })
}

function environmentSnapshot(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

function restoreEnvironment(snapshot: Readonly<Record<string, string>>): readonly string[] {
  const current = environmentSnapshot()
  const changed = new Set([...Object.keys(snapshot), ...Object.keys(current)])
  const mutations = [...changed].filter((key) => current[key] !== snapshot[key]).sort()
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) Reflect.deleteProperty(process.env, key)
  }
  for (const [key, value] of Object.entries(snapshot)) process.env[key] = value
  return mutations
}

function installProcessAndNetworkMocks(): void {
  const deniedChildProcess = {
    exec: (): never => deny('child_process.exec'),
    execFile: (): never => deny('child_process.execFile'),
    execFileSync: (): never => deny('child_process.execFileSync'),
    execSync: (): never => deny('child_process.execSync'),
    fork: (): never => deny('child_process.fork'),
    spawn: (): never => deny('child_process.spawn'),
    spawnSync: (): never => deny('child_process.spawnSync'),
  }
  void mock.module('node:child_process', () => ({
    ...childProcess,
    ...deniedChildProcess,
    default: { ...childProcess, ...deniedChildProcess },
  }))
  const deniedNet = {
    connect: (): never => deny('net.connect'),
    createConnection: (): never => deny('net.createConnection'),
  }
  void mock.module('node:net', () => ({ ...net, ...deniedNet, default: { ...net, ...deniedNet } }))
  Reflect.set(net.Server.prototype, 'listen', function guardedListen(): never {
    return deny('net.Server.listen')
  })
  Reflect.set(net.Socket.prototype, 'connect', function guardedConnect(): never {
    return deny('net.Socket.connect')
  })
}

export function installIoGuard(): void {
  if (installed) return
  installed = true
  installFilesystemGuard(
    active,
    () => storage.getStore(),
    (operation) => diagnostic(active(operation), operation),
  )
  installProcessAndNetworkMocks()
  installProcessListenerTracking()
  Reflect.set(globalThis, 'fetch', (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const boundary = active('fetch')
    if (boundary.bindings === undefined) throw diagnostic(boundary, 'fetch')
    return boundary.bindings.http.fetch(input, init)
  })
  Reflect.set(Bun, 'spawn', () => deny('Bun.spawn'))
  Reflect.set(Bun, 'spawnSync', () => deny('Bun.spawnSync'))
  Reflect.set(Bun, 'serve', () => deny('Bun.serve'))
  Reflect.set(Bun, 'write', (...args: unknown[]): unknown => {
    assertGuardedWritePath(bunWriteTarget(args[0]), 'Bun.write', active, (operation) =>
      diagnostic(active(operation), operation),
    )
    return invoke(originals.bunWrite, args)
  })
  timerGuard = installTimerGuard(() => storage.getStore())
}

export function restoreIoGuard(): void {
  if (!installed) return
  installed = false
  Reflect.set(globalThis, 'fetch', originals.fetch)
  timerGuard?.restore()
  timerGuard = undefined
  Reflect.set(Bun, 'spawn', originals.bunSpawn)
  Reflect.set(Bun, 'spawnSync', originals.bunSpawnSync)
  Reflect.set(Bun, 'serve', originals.bunServe)
  Reflect.set(Bun, 'write', originals.bunWrite)
  if (originals.serverListenDescriptor !== undefined) {
    Object.defineProperty(net.Server.prototype, 'listen', originals.serverListenDescriptor)
  }
  if (originals.socketConnectDescriptor !== undefined) {
    Object.defineProperty(net.Socket.prototype, 'connect', originals.socketConnectDescriptor)
  }
  for (const [name, descriptor] of processMethodDescriptors) {
    if (descriptor === undefined) Reflect.deleteProperty(process, name)
    else Object.defineProperty(process, name, descriptor)
  }
  mock.restore()
}

function cleanupTrackedResources(boundary: Boundary): void {
  for (const record of boundary.listeners) invoke(processMethods.removeListener, [record.event, record.listener])
  boundary.listeners.clear()
  for (const fd of boundary.writableFileDescriptors) {
    try {
      originals.fsCloseSync(fd)
    } catch {
      // The owner may already have closed the descriptor without using a guarded close surface.
    }
  }
  boundary.writableFileDescriptors.clear()
  const cleanup = (resources: Set<unknown>, methodName: string): void => {
    for (const resource of resources) {
      if (resource === null || (typeof resource !== 'object' && typeof resource !== 'function')) continue
      const method = Reflect.get(resource, methodName) as unknown
      if (typeof method === 'function') Reflect.apply(method, resource, [])
    }
    resources.clear()
  }
  cleanup(boundary.subprocesses, 'kill')
  cleanup(boundary.servers, 'close')
  cleanup(boundary.sockets, 'destroy')
}

function verifyBoundary(boundary: Boundary): void {
  const failures: string[] = []
  if (boundary.timers.size > 0) failures.push(`active timers: ${boundary.timers.size}`)
  if (boundary.listeners.size > 0) failures.push(`process listeners: ${boundary.listeners.size}`)
  if (boundary.subprocesses.size > 0) failures.push(`subprocesses: ${boundary.subprocesses.size}`)
  if (boundary.servers.size > 0) failures.push(`servers: ${boundary.servers.size}`)
  if (boundary.sockets.size > 0) failures.push(`sockets: ${boundary.sockets.size}`)
  if (boundary.writableFileDescriptors.size > 0) {
    failures.push(`file descriptors: ${boundary.writableFileDescriptors.size}`)
  }
  const mutations = restoreEnvironment(boundary.env)
  if (mutations.length > 0) failures.push(`environment mutations: ${mutations.join(', ')}`)
  cleanupTrackedResources(boundary)
  if (failures.length > 0) throw diagnostic(boundary, `scenario leaks (${failures.join('; ')})`)
}

export function runWithScenarioIoGuard<T>(
  name: string,
  work: (session: IoGuardSession | undefined) => Promise<T>,
): Promise<T> {
  if (!installed) return work(undefined)
  const tempRoot = originals.fsMkdtempSync(path.join(os.tmpdir(), 'papai-story-'))
  const boundary: Boundary = {
    name,
    tempRoot: originals.fsRealpathSync(tempRoot),
    env: environmentSnapshot(),
    timers: new Set(),
    listeners: new Set(),
    servers: new Set(),
    sockets: new Set(),
    subprocesses: new Set(),
    writableFileDescriptors: new Set(),
    bindings: undefined,
    allowCleanup: false,
  }
  return storage.run(boundary, async (): Promise<T> => {
    try {
      const result = await work({
        tempRoot: boundary.tempRoot,
        bind(bindings): void {
          boundary.bindings = bindings
        },
        verify: (): void => verifyBoundary(boundary),
      })
      verifyBoundary(boundary)
      return result
    } catch (primaryFailure) {
      const primaryError = primaryFailure instanceof Error ? primaryFailure : new Error(String(primaryFailure))
      try {
        verifyBoundary(boundary)
      } catch (verificationFailure) {
        const verificationError =
          verificationFailure instanceof Error ? verificationFailure : new Error(String(verificationFailure))
        return await Promise.reject(
          new AggregateError(
            [primaryError, verificationError],
            `Scenario "${name}" failed and leaked guarded resources`,
            { cause: verificationFailure },
          ),
        )
      }
      throw primaryError
    } finally {
      for (const timer of boundary.timers) {
        timerGuard?.dispose(timer)
      }
      boundary.allowCleanup = true
      originals.fsRmSync(boundary.tempRoot, { recursive: true, force: true })
      boundary.allowCleanup = false
      restoreEnvironment(boundary.env)
    }
  })
}
