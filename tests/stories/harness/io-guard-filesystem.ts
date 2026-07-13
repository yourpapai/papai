// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mock } from 'bun:test'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type FilesystemBoundary = Readonly<{
  tempRoot: string
  executionRoot: string
  allowCleanup: boolean
  writableFileDescriptors: Set<number>
}>

type ActiveBoundary = (operation: string) => FilesystemBoundary
type CurrentBoundary = () => FilesystemBoundary | undefined
type GuardFailure = (operation: string) => Error

const invoke = (fn: CallableFunction, args: readonly unknown[]): unknown => Reflect.apply(fn, undefined, args)
const invokeOn = (fn: CallableFunction, target: object, args: readonly unknown[]): unknown =>
  Reflect.apply(fn, target, args)
const originalFs = { ...fs }
const originalFsPromises = { ...fsPromises }
const originalNestedPromises = { ...fs.promises }

function nearestExisting(candidate: string): Readonly<{ logical: string; canonical: string }> {
  let cursor = candidate
  while (!originalFs.existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) return { logical: cursor, canonical: cursor }
    cursor = parent
  }
  return { logical: cursor, canonical: originalFs.realpathSync(cursor) }
}

function canonicalPath(value: unknown, operation: string, failure: GuardFailure): string {
  if (typeof value !== 'string' && !(value instanceof URL)) throw failure(operation)
  const candidate = path.resolve(value instanceof URL ? fileURLToPath(value) : value)
  const ancestor = nearestExisting(candidate)
  return path.resolve(ancestor.canonical, path.relative(ancestor.logical, candidate))
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function assertGuardedWritePath(
  value: unknown,
  operation: string,
  active: ActiveBoundary,
  failure: GuardFailure,
): void {
  const boundary = active(operation)
  if (boundary.allowCleanup) return
  if (isWithin(boundary.tempRoot, canonicalPath(value, operation, failure))) return
  throw failure(operation)
}

export function assertGuardedReadPath(
  value: unknown,
  operation: string,
  active: ActiveBoundary,
  failure: GuardFailure,
): void {
  const boundary = active(operation)
  const canonical = canonicalPath(value, operation, failure)
  if (isWithin(boundary.tempRoot, canonical) || isWithin(boundary.executionRoot, canonical)) return
  throw failure(operation)
}

function flagsPermitWrite(flags: unknown): boolean {
  if (flags === undefined) return false
  if (typeof flags === 'string') return /[wax+]/u.test(flags)
  if (typeof flags !== 'number') return true
  const mask =
    fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_TRUNC
  return (flags & mask) !== 0
}

function flagsPermitRead(flags: unknown): boolean {
  if (flags === undefined) return true
  if (typeof flags === 'string') return /r|\+/u.test(flags)
  if (typeof flags !== 'number') return true
  return (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) !== fs.constants.O_WRONLY
}

function guardedPaths(
  operation: string,
  indexes: readonly number[],
  fn: CallableFunction,
  active: ActiveBoundary,
  failure: GuardFailure,
) {
  return (...args: unknown[]): unknown => {
    for (const index of indexes) assertGuardedWritePath(args[index], operation, active, failure)
    return invoke(fn, args)
  }
}

function guardedReadPaths(
  operation: string,
  indexes: readonly number[],
  fn: CallableFunction,
  active: ActiveBoundary,
  failure: GuardFailure,
) {
  return (...args: unknown[]): unknown => {
    for (const index of indexes) assertGuardedReadPath(args[index], operation, active, failure)
    return invoke(fn, args)
  }
}

function globOptions(value: unknown): object | undefined {
  if (value === null || typeof value !== 'object' || value instanceof URL) return undefined
  return value
}

function staticGlobPrefix(pattern: string): string {
  const magic = pattern.search(/[!*?{}()]/u)
  if (magic === -1) return pattern
  const separator = Math.max(pattern.lastIndexOf('/', magic), pattern.lastIndexOf('\\', magic))
  return pattern.slice(0, separator + 1)
}

function hasDynamicGlobTraversal(pattern: string): boolean {
  const segments = pattern.split(/[\\/]/u).filter((segment) => segment.length > 0)
  return segments.some(
    (segment, index) =>
      segment === '**' ||
      (index < segments.length - 1 && (/[!*?{}()]/u.test(segment) || segment.includes('[') || segment.includes(']'))),
  )
}

function assertGuardedGlob(
  pattern: unknown,
  options: object | undefined,
  operation: string,
  active: ActiveBoundary,
  failure: GuardFailure,
): void {
  const configuredCwd: unknown = options === undefined ? undefined : (Reflect.get(options, 'cwd') as unknown)
  const cwd: unknown = configuredCwd === undefined ? process.cwd() : configuredCwd
  assertGuardedReadPath(cwd, operation, active, failure)
  if (typeof cwd !== 'string' && !(cwd instanceof URL)) throw failure(operation)
  const cwdPath = cwd instanceof URL ? fileURLToPath(cwd) : cwd
  const patterns = Array.isArray(pattern) ? pattern : [pattern]
  for (const value of patterns) {
    if (typeof value !== 'string') throw failure(operation)
    if (value.split(/[\\/]/u).includes('..')) throw failure(operation)
    if (hasDynamicGlobTraversal(value)) throw failure(operation)
    assertGuardedReadPath(path.resolve(cwdPath, staticGlobPrefix(value)), operation, active, failure)
  }
}

function guardedGlob(operation: string, fn: CallableFunction, active: ActiveBoundary, failure: GuardFailure) {
  return (...args: unknown[]): unknown => {
    assertGuardedGlob(args[0], globOptions(args[1]), operation, active, failure)
    return invoke(fn, args)
  }
}

function guardedCopy(operation: string, fn: CallableFunction, active: ActiveBoundary, failure: GuardFailure) {
  return (...args: unknown[]): unknown => {
    assertGuardedReadPath(args[0], operation, active, failure)
    assertGuardedWritePath(args[1], operation, active, failure)
    return invoke(fn, args)
  }
}

function guardedFd(operation: string, fn: CallableFunction, active: ActiveBoundary, failure: GuardFailure) {
  return (...args: unknown[]): unknown => {
    const boundary = active(operation)
    const fd = args[0]
    if (typeof fd !== 'number' || !boundary.writableFileDescriptors.has(fd)) throw failure(operation)
    return invoke(fn, args)
  }
}

type OpenWrappers = Readonly<{
  openSync: CallableFunction
  open: CallableFunction
  closeSync: CallableFunction
  close: CallableFunction
  promiseOpen: CallableFunction
}>

function createOpenWrappers(active: ActiveBoundary, current: CurrentBoundary, failure: GuardFailure): OpenWrappers {
  const openSync = (...args: unknown[]): unknown => {
    const writable = flagsPermitWrite(args[1])
    const readable = flagsPermitRead(args[1])
    if (writable) assertGuardedWritePath(args[0], 'fs.openSync', active, failure)
    if (readable) assertGuardedReadPath(args[0], 'fs.openSync', active, failure)
    const result = invoke(originalFs.openSync, args)
    if (writable && typeof result === 'number') active('fs.openSync').writableFileDescriptors.add(result)
    return result
  }
  const open = (...rawArgs: unknown[]): unknown => {
    const args = [...rawArgs]
    const flags = typeof args[1] === 'function' ? undefined : args[1]
    const writable = flagsPermitWrite(flags)
    const readable = flagsPermitRead(flags)
    if (writable) assertGuardedWritePath(args[0], 'fs.open', active, failure)
    if (readable) assertGuardedReadPath(args[0], 'fs.open', active, failure)
    const callback = args.at(-1)
    if (typeof callback === 'function') {
      args.splice(args.length - 1, 1, (error: unknown, fd: unknown, ...rest: unknown[]): unknown => {
        if ((error === null || error === undefined) && writable && typeof fd === 'number') {
          active('fs.open').writableFileDescriptors.add(fd)
        }
        return invoke(callback, [error, fd, ...rest])
      })
    }
    return invoke(originalFs.open, args)
  }
  const closeSync = (...args: unknown[]): unknown => {
    const result = invoke(originalFs.closeSync, args)
    if (typeof args[0] === 'number') current()?.writableFileDescriptors.delete(args[0])
    return result
  }
  const close = (...rawArgs: unknown[]): unknown => {
    const args = [...rawArgs]
    const fd = args[0]
    const callback = args.at(-1)
    if (typeof callback === 'function') {
      args.splice(args.length - 1, 1, (...callbackArgs: unknown[]): unknown => {
        if (typeof fd === 'number') current()?.writableFileDescriptors.delete(fd)
        return invoke(callback, callbackArgs)
      })
    }
    return invoke(originalFs.close, args)
  }
  const promiseOpen = async (...args: unknown[]): Promise<unknown> => {
    const writable = flagsPermitWrite(args[1])
    const readable = flagsPermitRead(args[1])
    if (writable) assertGuardedWritePath(args[0], 'fs.promises.open', active, failure)
    if (readable) assertGuardedReadPath(args[0], 'fs.promises.open', active, failure)
    const handle = await invoke(originalFsPromises.open, args)
    if (handle !== null && typeof handle === 'object') {
      const fd = Number(Reflect.get(handle, 'fd'))
      const closeMethod = Reflect.get(handle, 'close') as unknown
      if (writable && Number.isInteger(fd) && typeof closeMethod === 'function') {
        active('fs.promises.open').writableFileDescriptors.add(fd)
        Reflect.set(handle, 'close', async (...closeArgs: unknown[]): Promise<unknown> => {
          try {
            return await invokeOn(closeMethod, handle, closeArgs)
          } finally {
            current()?.writableFileDescriptors.delete(fd)
          }
        })
      }
      for (const methodName of ['chmod', 'chown', 'utimes'] as const) {
        const method = Reflect.get(handle, methodName) as unknown
        if (typeof method !== 'function') continue
        Reflect.set(handle, methodName, (...methodArgs: unknown[]): unknown => {
          assertGuardedWritePath(args[0], `fs.promises.FileHandle.${methodName}`, active, failure)
          return invokeOn(method, handle, methodArgs)
        })
      }
    }
    return handle
  }
  return { openSync, open, closeSync, close, promiseOpen }
}

type PathWrappers = Readonly<{
  sync: Readonly<Record<string, CallableFunction>>
  callbacks: Readonly<Record<string, CallableFunction>>
  promises: Readonly<Record<string, CallableFunction>>
}>

function pathWrappers(active: ActiveBoundary, failure: GuardFailure): PathWrappers {
  const sync = {
    readFileSync: guardedReadPaths('fs.readFileSync', [0], fs.readFileSync, active, failure),
    readdirSync: guardedReadPaths('fs.readdirSync', [0], fs.readdirSync, active, failure),
    opendirSync: guardedReadPaths('fs.opendirSync', [0], fs.opendirSync, active, failure),
    statSync: guardedReadPaths('fs.statSync', [0], fs.statSync, active, failure),
    statfsSync: guardedReadPaths('fs.statfsSync', [0], fs.statfsSync, active, failure),
    lstatSync: guardedReadPaths('fs.lstatSync', [0], fs.lstatSync, active, failure),
    accessSync: guardedReadPaths('fs.accessSync', [0], fs.accessSync, active, failure),
    existsSync: guardedReadPaths('fs.existsSync', [0], fs.existsSync, active, failure),
    realpathSync: guardedReadPaths('fs.realpathSync', [0], fs.realpathSync, active, failure),
    readlinkSync: guardedReadPaths('fs.readlinkSync', [0], fs.readlinkSync, active, failure),
    createReadStream: guardedReadPaths('fs.createReadStream', [0], fs.createReadStream, active, failure),
    globSync: guardedGlob('fs.globSync', fs.globSync, active, failure),
    writeFileSync: guardedPaths('fs.writeFileSync', [0], fs.writeFileSync, active, failure),
    appendFileSync: guardedPaths('fs.appendFileSync', [0], fs.appendFileSync, active, failure),
    createWriteStream: guardedPaths('fs.createWriteStream', [0], fs.createWriteStream, active, failure),
    truncateSync: guardedPaths('fs.truncateSync', [0], fs.truncateSync, active, failure),
    chmodSync: guardedPaths('fs.chmodSync', [0], fs.chmodSync, active, failure),
    chownSync: guardedPaths('fs.chownSync', [0], fs.chownSync, active, failure),
    utimesSync: guardedPaths('fs.utimesSync', [0], fs.utimesSync, active, failure),
    lchownSync: guardedPaths('fs.lchownSync', [0], fs.lchownSync, active, failure),
    lutimesSync: guardedPaths('fs.lutimesSync', [0], fs.lutimesSync, active, failure),
    mkdirSync: guardedPaths('fs.mkdirSync', [0], fs.mkdirSync, active, failure),
    mkdtempSync: guardedPaths('fs.mkdtempSync', [0], fs.mkdtempSync, active, failure),
    rmSync: guardedPaths('fs.rmSync', [0], fs.rmSync, active, failure),
    unlinkSync: guardedPaths('fs.unlinkSync', [0], fs.unlinkSync, active, failure),
    renameSync: guardedPaths('fs.renameSync', [0, 1], fs.renameSync, active, failure),
    copyFileSync: guardedCopy('fs.copyFileSync', fs.copyFileSync, active, failure),
    cpSync: guardedCopy('fs.cpSync', fs.cpSync, active, failure),
    symlinkSync: guardedPaths('fs.symlinkSync', [1], fs.symlinkSync, active, failure),
    linkSync: guardedPaths('fs.linkSync', [0, 1], fs.linkSync, active, failure),
  }
  const callbacks = {
    readFile: guardedReadPaths('fs.readFile', [0], fs.readFile, active, failure),
    readdir: guardedReadPaths('fs.readdir', [0], fs.readdir, active, failure),
    opendir: guardedReadPaths('fs.opendir', [0], fs.opendir, active, failure),
    stat: guardedReadPaths('fs.stat', [0], fs.stat, active, failure),
    statfs: guardedReadPaths('fs.statfs', [0], fs.statfs, active, failure),
    lstat: guardedReadPaths('fs.lstat', [0], fs.lstat, active, failure),
    access: guardedReadPaths('fs.access', [0], fs.access, active, failure),
    realpath: guardedReadPaths('fs.realpath', [0], fs.realpath, active, failure),
    readlink: guardedReadPaths('fs.readlink', [0], fs.readlink, active, failure),
    glob: guardedGlob('fs.glob', fs.glob, active, failure),
    watch: guardedReadPaths('fs.watch', [0], fs.watch, active, failure),
    watchFile: guardedReadPaths('fs.watchFile', [0], fs.watchFile, active, failure),
    writeFile: guardedPaths('fs.writeFile', [0], fs.writeFile, active, failure),
    appendFile: guardedPaths('fs.appendFile', [0], fs.appendFile, active, failure),
    truncate: guardedPaths('fs.truncate', [0], fs.truncate, active, failure),
    chmod: guardedPaths('fs.chmod', [0], fs.chmod, active, failure),
    chown: guardedPaths('fs.chown', [0], fs.chown, active, failure),
    utimes: guardedPaths('fs.utimes', [0], fs.utimes, active, failure),
    lchown: guardedPaths('fs.lchown', [0], fs.lchown, active, failure),
    lutimes: guardedPaths('fs.lutimes', [0], fs.lutimes, active, failure),
    mkdir: guardedPaths('fs.mkdir', [0], fs.mkdir, active, failure),
    mkdtemp: guardedPaths('fs.mkdtemp', [0], fs.mkdtemp, active, failure),
    rm: guardedPaths('fs.rm', [0], fs.rm, active, failure),
    unlink: guardedPaths('fs.unlink', [0], fs.unlink, active, failure),
    rename: guardedPaths('fs.rename', [0, 1], fs.rename, active, failure),
    copyFile: guardedCopy('fs.copyFile', fs.copyFile, active, failure),
    cp: guardedCopy('fs.cp', fs.cp, active, failure),
    symlink: guardedPaths('fs.symlink', [1], fs.symlink, active, failure),
    link: guardedPaths('fs.link', [0, 1], fs.link, active, failure),
  }
  const promises = {
    readFile: guardedReadPaths('fs.promises.readFile', [0], fsPromises.readFile, active, failure),
    readdir: guardedReadPaths('fs.promises.readdir', [0], fsPromises.readdir, active, failure),
    opendir: guardedReadPaths('fs.promises.opendir', [0], fsPromises.opendir, active, failure),
    stat: guardedReadPaths('fs.promises.stat', [0], fsPromises.stat, active, failure),
    statfs: guardedReadPaths('fs.promises.statfs', [0], fsPromises.statfs, active, failure),
    lstat: guardedReadPaths('fs.promises.lstat', [0], fsPromises.lstat, active, failure),
    access: guardedReadPaths('fs.promises.access', [0], fsPromises.access, active, failure),
    realpath: guardedReadPaths('fs.promises.realpath', [0], fsPromises.realpath, active, failure),
    readlink: guardedReadPaths('fs.promises.readlink', [0], fsPromises.readlink, active, failure),
    glob: guardedGlob('fs.promises.glob', fsPromises.glob, active, failure),
    watch: guardedReadPaths('fs.promises.watch', [0], fsPromises.watch, active, failure),
    writeFile: guardedPaths('fs.promises.writeFile', [0], fsPromises.writeFile, active, failure),
    appendFile: guardedPaths('fs.promises.appendFile', [0], fsPromises.appendFile, active, failure),
    truncate: guardedPaths('fs.promises.truncate', [0], fsPromises.truncate, active, failure),
    chmod: guardedPaths('fs.promises.chmod', [0], fsPromises.chmod, active, failure),
    chown: guardedPaths('fs.promises.chown', [0], fsPromises.chown, active, failure),
    utimes: guardedPaths('fs.promises.utimes', [0], fsPromises.utimes, active, failure),
    lchown: guardedPaths('fs.promises.lchown', [0], fsPromises.lchown, active, failure),
    lutimes: guardedPaths('fs.promises.lutimes', [0], fsPromises.lutimes, active, failure),
    mkdir: guardedPaths('fs.promises.mkdir', [0], fsPromises.mkdir, active, failure),
    mkdtemp: guardedPaths('fs.promises.mkdtemp', [0], fsPromises.mkdtemp, active, failure),
    rm: guardedPaths('fs.promises.rm', [0], fsPromises.rm, active, failure),
    unlink: guardedPaths('fs.promises.unlink', [0], fsPromises.unlink, active, failure),
    rename: guardedPaths('fs.promises.rename', [0, 1], fsPromises.rename, active, failure),
    copyFile: guardedCopy('fs.promises.copyFile', fsPromises.copyFile, active, failure),
    cp: guardedCopy('fs.promises.cp', fsPromises.cp, active, failure),
    symlink: guardedPaths('fs.promises.symlink', [1], fsPromises.symlink, active, failure),
    link: guardedPaths('fs.promises.link', [0, 1], fsPromises.link, active, failure),
  }
  return { sync, callbacks, promises }
}

export function installFilesystemGuard(active: ActiveBoundary, current: CurrentBoundary, failure: GuardFailure): void {
  const paths = pathWrappers(active, failure)
  const opens = createOpenWrappers(active, current, failure)
  const fd = {
    write: guardedFd('fs.write', fs.write, active, failure),
    writeSync: guardedFd('fs.writeSync', fs.writeSync, active, failure),
    writev: guardedFd('fs.writev', fs.writev, active, failure),
    writevSync: guardedFd('fs.writevSync', fs.writevSync, active, failure),
    ftruncate: guardedFd('fs.ftruncate', fs.ftruncate, active, failure),
    ftruncateSync: guardedFd('fs.ftruncateSync', fs.ftruncateSync, active, failure),
    fchmod: guardedFd('fs.fchmod', fs.fchmod, active, failure),
    fchmodSync: guardedFd('fs.fchmodSync', fs.fchmodSync, active, failure),
    fchown: guardedFd('fs.fchown', fs.fchown, active, failure),
    fchownSync: guardedFd('fs.fchownSync', fs.fchownSync, active, failure),
    futimes: guardedFd('fs.futimes', fs.futimes, active, failure),
    futimesSync: guardedFd('fs.futimesSync', fs.futimesSync, active, failure),
  }
  const promiseOverrides = { ...paths.promises, open: opens.promiseOpen }
  const overrides = {
    ...paths.sync,
    ...paths.callbacks,
    ...fd,
    openSync: opens.openSync,
    open: opens.open,
    closeSync: opens.closeSync,
    close: opens.close,
  }
  void mock.module('node:fs/promises', () => ({
    ...originalFsPromises,
    ...promiseOverrides,
    default: { ...originalFsPromises, ...promiseOverrides },
  }))
  void mock.module('node:fs', () => ({
    ...originalFs,
    ...overrides,
    promises: { ...originalNestedPromises, ...promiseOverrides },
    default: { ...originalFs, ...overrides, promises: { ...originalNestedPromises, ...promiseOverrides } },
  }))
}

export function restoreFilesystemGuard(): void {
  void mock.module('node:fs/promises', () => ({
    ...originalFsPromises,
    default: { ...originalFsPromises },
  }))
  void mock.module('node:fs', () => ({
    ...originalFs,
    promises: { ...originalNestedPromises },
    default: { ...originalFs, promises: { ...originalNestedPromises } },
  }))
}
