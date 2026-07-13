// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mock } from 'bun:test'
import timers from 'node:timers'
import timersPromises from 'node:timers/promises'

export type TimerBoundary = Readonly<{ timers: Set<unknown> }>
type CurrentBoundary = () => TimerBoundary | undefined

const originals = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setImmediate: globalThis.setImmediate,
  clearImmediate: globalThis.clearImmediate,
}
const originalTimers = { ...timers }
const originalTimerPromises = { ...timersPromises }

const invoke = (fn: CallableFunction, target: unknown, args: readonly unknown[]): unknown =>
  Reflect.apply(fn, target, args)

function setRef(handle: unknown, ref: boolean | undefined): void {
  if (ref !== false || handle === null || (typeof handle !== 'object' && typeof handle !== 'function')) return
  const unref = Reflect.get(handle, 'unref') as unknown
  if (typeof unref === 'function') Reflect.apply(unref, handle, [])
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
}

type PromiseTimerOptions = Readonly<{ signal?: AbortSignal; ref?: boolean }>

export type InstalledTimerGuard = Readonly<{
  restore(): void
  dispose(handle: unknown): void
}>

export function installTimerGuard(current: CurrentBoundary): InstalledTimerGuard {
  const setTimeoutGuarded = (callback: TimerHandler, delay?: number, ...args: unknown[]): unknown => {
    const boundary = current()
    if (boundary === undefined) return originals.setTimeout(callback, delay, ...args)
    let handle: unknown
    const wrapped = (...callbackArgs: unknown[]): void => {
      boundary.timers.delete(handle)
      if (typeof callback === 'function') Reflect.apply(callback, undefined, callbackArgs)
    }
    handle = originals.setTimeout(wrapped, delay, ...args)
    boundary.timers.add(handle)
    return handle
  }
  const clearTimeoutGuarded = (handle?: unknown): void => {
    current()?.timers.delete(handle)
    invoke(originals.clearTimeout, globalThis, [handle])
  }
  const setIntervalGuarded = (callback: TimerHandler, delay?: number, ...args: unknown[]): unknown => {
    const handle = originals.setInterval(callback, delay, ...args)
    current()?.timers.add(handle)
    return handle
  }
  const clearIntervalGuarded = (handle?: unknown): void => {
    current()?.timers.delete(handle)
    invoke(originals.clearInterval, globalThis, [handle])
  }
  const setImmediateGuarded = (callback: (...args: unknown[]) => void, ...args: unknown[]): unknown => {
    const boundary = current()
    if (boundary === undefined) return originals.setImmediate(callback, ...args)
    let handle: unknown
    const wrapped = (...callbackArgs: unknown[]): void => {
      boundary.timers.delete(handle)
      Reflect.apply(callback, undefined, callbackArgs)
    }
    handle = originals.setImmediate(wrapped, ...args)
    boundary.timers.add(handle)
    return handle
  }
  const clearImmediateGuarded = (handle?: unknown): void => {
    current()?.timers.delete(handle)
    invoke(originals.clearImmediate, globalThis, [handle])
  }

  const promiseTimeout = <T>(delay = 1, value?: T, options: PromiseTimerOptions = {}): Promise<T | undefined> =>
    new Promise<T | undefined>((resolve, reject) => {
      if (options.signal?.aborted === true) {
        reject(abortError())
        return
      }
      const onAbort = (): void => {
        clearTimeoutGuarded(handle)
        reject(abortError())
      }
      const handle = setTimeoutGuarded((): void => {
        options.signal?.removeEventListener('abort', onAbort)
        resolve(value)
      }, delay)
      setRef(handle, options.ref)
      options.signal?.addEventListener('abort', onAbort, { once: true })
    })

  const promiseImmediate = <T>(value?: T, options: PromiseTimerOptions = {}): Promise<T | undefined> =>
    new Promise<T | undefined>((resolve, reject) => {
      if (options.signal?.aborted === true) {
        reject(abortError())
        return
      }
      const onAbort = (): void => {
        clearImmediateGuarded(handle)
        reject(abortError())
      }
      const handle = setImmediateGuarded((): void => {
        options.signal?.removeEventListener('abort', onAbort)
        resolve(value)
      })
      setRef(handle, options.ref)
      options.signal?.addEventListener('abort', onAbort, { once: true })
    })

  const promiseInterval = <T>(
    delay = 1,
    value?: T,
    options: PromiseTimerOptions = {},
  ): AsyncIterableIterator<T | undefined> => {
    let active = true
    let queued = 0
    const waiting: Array<
      Readonly<{ resolve(result: IteratorResult<T | undefined>): void; reject(error: Error): void }>
    > = []
    const finish = (): void => {
      if (!active) return
      active = false
      clearIntervalGuarded(handle)
      options.signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      finish()
      const error = abortError()
      for (const waiter of waiting.splice(0)) waiter.reject(error)
    }
    const handle = setIntervalGuarded((): void => {
      const waiter = waiting.shift()
      if (waiter === undefined) queued += 1
      else waiter.resolve({ value, done: false })
    }, delay)
    setRef(handle, options.ref)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted === true) onAbort()
    return {
      [Symbol.asyncIterator](): AsyncIterableIterator<T | undefined> {
        return this
      },
      next(): Promise<IteratorResult<T | undefined>> {
        if (!active) return Promise.resolve({ value: undefined, done: true })
        if (queued > 0) {
          queued -= 1
          return Promise.resolve({ value, done: false })
        }
        return new Promise((resolve, reject) => {
          waiting.push({ resolve, reject })
        })
      },
      return(): Promise<IteratorResult<T | undefined>> {
        finish()
        for (const waiter of waiting.splice(0)) waiter.resolve({ value: undefined, done: true })
        return Promise.resolve({ value: undefined, done: true })
      },
      throw(error?: unknown): Promise<IteratorResult<T | undefined>> {
        finish()
        const failure = error instanceof Error ? error : new Error(String(error))
        for (const waiter of waiting.splice(0)) waiter.reject(failure)
        return Promise.reject(failure)
      },
    }
  }

  const guardedScheduler = Object.freeze({
    wait(delay: number, options: PromiseTimerOptions = {}): Promise<undefined> {
      return promiseTimeout(delay, undefined, options)
    },
    yield(): Promise<undefined> {
      return promiseImmediate(undefined)
    },
  })

  const timerOverrides = {
    setTimeout: setTimeoutGuarded,
    clearTimeout: clearTimeoutGuarded,
    setInterval: setIntervalGuarded,
    clearInterval: clearIntervalGuarded,
    setImmediate: setImmediateGuarded,
    clearImmediate: clearImmediateGuarded,
  }
  const promiseOverrides = {
    setTimeout: promiseTimeout,
    setImmediate: promiseImmediate,
    setInterval: promiseInterval,
    scheduler: guardedScheduler,
  }
  void mock.module('node:timers', () => ({
    ...originalTimers,
    ...timerOverrides,
    default: { ...originalTimers, ...timerOverrides },
  }))
  void mock.module('node:timers/promises', () => ({
    ...originalTimerPromises,
    ...promiseOverrides,
    default: { ...originalTimerPromises, ...promiseOverrides },
  }))
  for (const [name, implementation] of Object.entries(timerOverrides)) Reflect.set(globalThis, name, implementation)

  return {
    restore(): void {
      Reflect.set(globalThis, 'setTimeout', originals.setTimeout)
      Reflect.set(globalThis, 'clearTimeout', originals.clearTimeout)
      Reflect.set(globalThis, 'setInterval', originals.setInterval)
      Reflect.set(globalThis, 'clearInterval', originals.clearInterval)
      Reflect.set(globalThis, 'setImmediate', originals.setImmediate)
      Reflect.set(globalThis, 'clearImmediate', originals.clearImmediate)
      void mock.module('node:timers', () => ({ ...originalTimers, default: { ...originalTimers } }))
      void mock.module('node:timers/promises', () => ({
        ...originalTimerPromises,
        default: { ...originalTimerPromises },
      }))
    },
    dispose(handle): void {
      invoke(originals.clearTimeout, globalThis, [handle])
      invoke(originals.clearInterval, globalThis, [handle])
      invoke(originals.clearImmediate, globalThis, [handle])
    },
  }
}
