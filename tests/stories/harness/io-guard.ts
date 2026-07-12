// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mock } from 'bun:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ScenarioEvents } from './events.js'
import type { StrictHttpDispatcher } from './strict-http.js'

type BoundaryBindings = Readonly<{
  events: ScenarioEvents
  http: StrictHttpDispatcher
}>

type TimerHandle = unknown

type Boundary = {
  readonly name: string
  readonly tempRoot: string
  readonly env: Readonly<Record<string, string>>
  readonly timers: Set<TimerHandle>
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

const originals = {
  fetch: globalThis.fetch,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  bunSpawn: Bun.spawn,
  bunSpawnSync: Bun.spawnSync,
  bunServe: Bun.serve,
  bunWrite: Bun.write,
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

function nearestExisting(candidate: string): Readonly<{ logical: string; canonical: string }> {
  let cursor = candidate
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) return { logical: cursor, canonical: cursor }
    cursor = parent
  }
  return { logical: cursor, canonical: fs.realpathSync(cursor) }
}

function assertWritePath(value: unknown, operation: string): void {
  const boundary = active(operation)
  if (boundary.allowCleanup) return
  if (typeof value !== 'string' && !(value instanceof URL)) throw diagnostic(boundary, operation)
  const candidate = path.resolve(value instanceof URL ? fileURLToPath(value) : value)
  const ancestor = nearestExisting(candidate)
  const canonical = path.resolve(ancestor.canonical, path.relative(ancestor.logical, candidate))
  const relative = path.relative(boundary.tempRoot, canonical)
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))
    return
  throw diagnostic(boundary, operation)
}

const invoke = (fn: CallableFunction, args: readonly unknown[]): unknown => Reflect.apply(fn, undefined, args)

function guardedCall(operation: string, paths: readonly number[], fn: CallableFunction) {
  return (...args: unknown[]): unknown => {
    for (const index of paths) assertWritePath(args[index], operation)
    return invoke(fn, args)
  }
}

function installFilesystemMocks(): void {
  const sync = {
    writeFileSync: guardedCall('fs.writeFileSync', [0], fs.writeFileSync),
    appendFileSync: guardedCall('fs.appendFileSync', [0], fs.appendFileSync),
    mkdirSync: guardedCall('fs.mkdirSync', [0], fs.mkdirSync),
    rmSync: guardedCall('fs.rmSync', [0], fs.rmSync),
    renameSync: guardedCall('fs.renameSync', [0, 1], fs.renameSync),
    copyFileSync: guardedCall('fs.copyFileSync', [1], fs.copyFileSync),
    symlinkSync: guardedCall('fs.symlinkSync', [1], fs.symlinkSync),
  }
  const callbacks = {
    writeFile: guardedCall('fs.writeFile', [0], fs.writeFile),
    appendFile: guardedCall('fs.appendFile', [0], fs.appendFile),
    mkdir: guardedCall('fs.mkdir', [0], fs.mkdir),
    rm: guardedCall('fs.rm', [0], fs.rm),
    rename: guardedCall('fs.rename', [0, 1], fs.rename),
    copyFile: guardedCall('fs.copyFile', [1], fs.copyFile),
    symlink: guardedCall('fs.symlink', [1], fs.symlink),
  }
  const promises = {
    writeFile: guardedCall('fs.promises.writeFile', [0], fsPromises.writeFile),
    appendFile: guardedCall('fs.promises.appendFile', [0], fsPromises.appendFile),
    mkdir: guardedCall('fs.promises.mkdir', [0], fsPromises.mkdir),
    rm: guardedCall('fs.promises.rm', [0], fsPromises.rm),
    rename: guardedCall('fs.promises.rename', [0, 1], fsPromises.rename),
    copyFile: guardedCall('fs.promises.copyFile', [1], fsPromises.copyFile),
    symlink: guardedCall('fs.promises.symlink', [1], fsPromises.symlink),
  }
  void mock.module('node:fs/promises', () => ({
    ...fsPromises,
    ...promises,
    default: { ...fsPromises, ...promises },
  }))
  void mock.module('node:fs', () => ({
    ...fs,
    ...sync,
    ...callbacks,
    promises: { ...fs.promises, ...promises },
    default: { ...fs, ...sync, ...callbacks, promises: { ...fs.promises, ...promises } },
  }))
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

function installTimers(): void {
  const guardedSetTimeout = (callback: TimerHandler, delay?: number, ...args: unknown[]): TimerHandle => {
    const boundary = storage.getStore()
    if (boundary === undefined) return originals.setTimeout(callback, delay, ...args)
    let handle: TimerHandle
    const wrapped = (...callbackArgs: unknown[]): void => {
      boundary.timers.delete(handle)
      if (typeof callback === 'function') Reflect.apply(callback, undefined, callbackArgs)
    }
    handle = originals.setTimeout(wrapped, delay, ...args)
    boundary.timers.add(handle)
    return handle
  }
  const guardedClearTimeout = (handle?: TimerHandle): void => {
    storage.getStore()?.timers.delete(handle)
    Reflect.apply(originals.clearTimeout, globalThis, [handle])
  }
  const guardedSetInterval = (callback: TimerHandler, delay?: number, ...args: unknown[]): TimerHandle => {
    const handle = originals.setInterval(callback, delay, ...args)
    storage.getStore()?.timers.add(handle)
    return handle
  }
  const guardedClearInterval = (handle?: TimerHandle): void => {
    storage.getStore()?.timers.delete(handle)
    Reflect.apply(originals.clearInterval, globalThis, [handle])
  }
  Reflect.set(globalThis, 'setTimeout', guardedSetTimeout)
  Reflect.set(globalThis, 'clearTimeout', guardedClearTimeout)
  Reflect.set(globalThis, 'setInterval', guardedSetInterval)
  Reflect.set(globalThis, 'clearInterval', guardedClearInterval)
}

export function installIoGuard(): void {
  if (installed) return
  installed = true
  installFilesystemMocks()
  installProcessAndNetworkMocks()
  Reflect.set(globalThis, 'fetch', (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const boundary = active('fetch')
    if (boundary.bindings === undefined) throw diagnostic(boundary, 'fetch')
    return boundary.bindings.http.fetch(input, init)
  })
  Reflect.set(Bun, 'spawn', () => deny('Bun.spawn'))
  Reflect.set(Bun, 'spawnSync', () => deny('Bun.spawnSync'))
  Reflect.set(Bun, 'serve', () => deny('Bun.serve'))
  Reflect.set(Bun, 'write', () => deny('Bun.write'))
  installTimers()
}

export function restoreIoGuard(): void {
  if (!installed) return
  installed = false
  Reflect.set(globalThis, 'fetch', originals.fetch)
  Reflect.set(globalThis, 'setTimeout', originals.setTimeout)
  Reflect.set(globalThis, 'clearTimeout', originals.clearTimeout)
  Reflect.set(globalThis, 'setInterval', originals.setInterval)
  Reflect.set(globalThis, 'clearInterval', originals.clearInterval)
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
  mock.restore()
}

function verifyBoundary(boundary: Boundary): void {
  const failures: string[] = []
  if (boundary.timers.size > 0) failures.push(`active timers: ${boundary.timers.size}`)
  const mutations = restoreEnvironment(boundary.env)
  if (mutations.length > 0) failures.push(`environment mutations: ${mutations.join(', ')}`)
  if (failures.length > 0) throw diagnostic(boundary, `scenario leaks (${failures.join('; ')})`)
}

export function runWithScenarioIoGuard<T>(
  name: string,
  work: (session: IoGuardSession | undefined) => Promise<T>,
): Promise<T> {
  if (!installed) return work(undefined)
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'papai-story-'))
  const boundary: Boundary = {
    name,
    tempRoot: fs.realpathSync(tempRoot),
    env: environmentSnapshot(),
    timers: new Set(),
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
        Reflect.apply(originals.clearTimeout, globalThis, [timer])
        Reflect.apply(originals.clearInterval, globalThis, [timer])
      }
      boundary.allowCleanup = true
      fs.rmSync(boundary.tempRoot, { recursive: true, force: true })
      boundary.allowCleanup = false
      restoreEnvironment(boundary.env)
    }
  })
}
