// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type InstanceConfig = Record<string, string>

export type PlatformInstanceType = 'telegram' | 'mattermost' | 'discord' | 'kontur-talk'
export type TaskInstanceType = string
export type InstanceStatus = 'pending' | 'active' | 'stopped'

export interface PlatformInstance {
  id: string
  type: PlatformInstanceType
  config: InstanceConfig
  status: InstanceStatus
  createdAt: string
}

export interface TaskInstance {
  id: string
  type: TaskInstanceType
  config: InstanceConfig
  status: InstanceStatus
  createdAt: string
}

export type InstanceDecodeFailure = Readonly<{
  table: 'platform_instances' | 'task_instances'
  id: string
  type: string
  error: string
}>

export type InstanceDecodeResult<T> = Readonly<{
  instances: T[]
  failures: InstanceDecodeFailure[]
}>

export interface ContextSettings {
  contextId: string
  /** Null when the context has a platform assignment but no task provider yet (e.g. seeded on first message, pre-`/config`). */
  taskInstanceId: string | null
  platformInstanceId: string
}

export interface AdminRecord {
  userId: string
  platformInstanceId: string
  createdAt: string
}

export type BootstrapResult =
  | { bootstrapped: true; platformInstanceId: string }
  | { bootstrapped: false; reason: 'no-env' | 'already-bootstrapped' | 'partial-env'; missing?: string[] }
