// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type InstanceConfig = Record<string, string>

export type PlatformInstanceType = 'telegram' | 'mattermost' | 'discord'
export type TaskInstanceType = string
export type BuiltinTaskType = 'kaneo' | 'youtrack'
export type InstanceStatus = 'pending' | 'active' | 'stopped'

export const isBuiltinTaskType = (type: string): type is BuiltinTaskType => type === 'kaneo' || type === 'youtrack'

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

export interface ContextSettings {
  contextId: string
  taskInstanceId: string
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
