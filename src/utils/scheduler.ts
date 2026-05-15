// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Core scheduler implementation for papai.
 *
 * Provides robust task scheduling with error handling, retries, and graceful shutdown.
 * Replaces raw `setInterval` usage with a centralized, testable utility.
 */

import { createEmitters } from './scheduler.events.js'
import { type EventEmitter, mergeOptions, type Task } from './scheduler.helpers.js'
import {
  type SchedulerContext,
  getTaskState,
  registerTask,
  startAllTasks,
  startTask,
  stopAllTasks,
  stopTask,
  taskExists,
  unregisterTask,
} from './scheduler.operations.js'
import type {
  ErrorHandler,
  FatalErrorHandler,
  RetryHandler,
  SchedulerOptions,
  TaskConfig,
  TaskState,
  TickHandler,
} from './scheduler.types.js'

/**
 * Event handler type mapping for type-safe event registration.
 */
interface EventHandlerMap {
  tick: TickHandler
  error: ErrorHandler
  retry: RetryHandler
  fatalError: FatalErrorHandler
}

/**
 * Scheduler interface returned by createScheduler.
 */
export interface Scheduler {
  register: (name: string, config: Omit<TaskConfig, 'name'>) => void
  start: (name: string) => void
  stop: (name: string) => void
  unregister: (name: string) => void
  startAll: () => void
  stopAll: () => void
  hasTask: (name: string) => boolean
  getTaskState: (name: string) => TaskState | null
  on: <E extends keyof EventHandlerMap>(event: E, handler: EventHandlerMap[E]) => void
}

/**
 * Create bound functions for scheduler operations.
 */
const createBoundFunctions = (
  context: SchedulerContext,
): {
  start: (name: string) => void
  stop: (name: string) => void
} => {
  // Create bound functions for circular dependencies
  const boundStop = (name: string): void => {
    stopTask(context, name)
  }
  const boundStart = (name: string): void => {
    startTask(context, name, boundStop)
  }

  return { start: boundStart, stop: boundStop }
}

interface SchedulerMethods {
  register: (name: string, config: Omit<TaskConfig, 'name'>) => void
  unregister: (name: string) => void
  startAll: () => void
  stopAll: () => void
  hasTask: (name: string) => boolean
  getState: (name: string) => TaskState | null
  on: <E extends keyof EventHandlerMap>(event: E, handler: EventHandlerMap[E]) => void
}

const createSchedulerMethods = (
  context: SchedulerContext,
  start: (name: string) => void,
  stop: (name: string) => void,
  events: EventEmitter,
): SchedulerMethods => {
  const register = (name: string, config: Omit<TaskConfig, 'name'>): void => {
    registerTask(context, name, config, start)
  }

  const unregister = (name: string): void => {
    unregisterTask(context, name, stop)
  }

  const startAll = (): void => {
    startAllTasks(context, start)
  }

  const stopAll = (): void => {
    stopAllTasks(context, stop)
  }

  const hasTask = (name: string): boolean => taskExists(context, name)

  const getState = (name: string): TaskState | null => getTaskState(context, name)

  const on = <E extends keyof EventHandlerMap>(event: E, handler: EventHandlerMap[E]): void => {
    const handlerSets: { [K in keyof EventHandlerMap]: Set<EventHandlerMap[K]> } = events
    handlerSets[event].add(handler)
  }

  return { register, unregister, startAll, stopAll, hasTask, getState, on }
}

/**
 * Create a new scheduler instance.
 *
 * @param options - Optional scheduler configuration
 * @returns Scheduler interface
 */
export const createScheduler = (options?: SchedulerOptions): Scheduler => {
  const schedulerOptions = mergeOptions(options)
  const tasks = new Map<string, Task>()
  const events: EventEmitter = {
    tick: new Set(),
    error: new Set(),
    retry: new Set(),
    fatalError: new Set(),
  }

  const emitters = createEmitters(events)
  const context: SchedulerContext = {
    tasks,
    events,
    emitters,
    schedulerOptions,
  }

  const boundFunctions = createBoundFunctions(context)
  const { start, stop } = boundFunctions
  const methods = createSchedulerMethods(context, start, stop, events)

  return {
    register: methods.register,
    start,
    stop,
    unregister: methods.unregister,
    startAll: methods.startAll,
    stopAll: methods.stopAll,
    hasTask: methods.hasTask,
    getTaskState: methods.getState,
    on: methods.on,
  }
}

// Re-export types and errors for convenience
export {
  FatalError,
  RetryableError,
  SchedulerError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
} from './scheduler.errors.js'
export type {
  ErrorEvent,
  ErrorHandler,
  FatalErrorEvent,
  FatalErrorHandler,
  RetryEvent,
  RetryHandler,
  SchedulerOptions,
  TaskConfig,
  TaskHandler,
  TaskOptions,
  TaskState,
  TickEvent,
  TickHandler,
} from './scheduler.types.js'
