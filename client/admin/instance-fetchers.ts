// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type {
  AdminInstanceView,
  ApplyInstancesResult,
  InstanceConfigView,
  PlatformInstanceView,
  TaskInstanceView,
  TaskProviderTypeView,
} from '../shared/api-types.js'
import { readBody, requireOk } from '../shared/fetcher-helpers.js'
import {
  AdminInstanceViewSchema,
  ApplyInstancesResultSchema,
  PlatformInstanceViewSchema,
  TaskInstanceViewSchema,
  TaskProviderTypeViewSchema,
} from './fetcher-schemas.js'

export type CreatePlatformInstanceInput = {
  readonly id: string
  readonly type: PlatformInstanceView['type']
  readonly config: InstanceConfigView
}

export type CreateTaskInstanceInput = {
  readonly id: string
  readonly type: TaskInstanceView['type']
  readonly config: InstanceConfigView
}

export type CreateAdminInput =
  | { readonly userId: string; readonly platformInstanceId: string }
  | { readonly userId: string }

export type PlatformInstanceStatusInput = 'active' | 'stopped'

export type UpdatePlatformInstanceInput =
  | { readonly config: InstanceConfigView }
  | { readonly status: PlatformInstanceStatusInput | 'pending' }
  | { readonly config: InstanceConfigView; readonly status: PlatformInstanceStatusInput | 'pending' }

export type UpdateTaskInstanceInput =
  | { readonly config: InstanceConfigView }
  | { readonly status: TaskInstanceView['status'] }
  | { readonly config: InstanceConfigView; readonly status: TaskInstanceView['status'] }

export const fetchPlatformInstances = async (): Promise<PlatformInstanceView[]> => {
  const res = await fetch('/api/platform-instances')
  const body = await readBody(res)
  requireOk(res, body)
  return z.array(PlatformInstanceViewSchema).parse(body)
}

export const createPlatformInstance = async (input: CreatePlatformInstanceInput): Promise<PlatformInstanceView> => {
  const res = await fetch('/api/platform-instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return PlatformInstanceViewSchema.parse(body)
}

export const setPlatformInstanceStatus = async (
  id: string,
  status: PlatformInstanceStatusInput,
): Promise<PlatformInstanceView> => {
  const res = await fetch(`/api/platform-instances/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return PlatformInstanceViewSchema.parse(body)
}

export const updatePlatformInstance = async (
  id: string,
  input: UpdatePlatformInstanceInput,
): Promise<PlatformInstanceView> => {
  const res = await fetch(`/api/platform-instances/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return PlatformInstanceViewSchema.parse(body)
}

export const updateTaskInstance = async (id: string, input: UpdateTaskInstanceInput): Promise<TaskInstanceView> => {
  const res = await fetch(`/api/task-instances/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return TaskInstanceViewSchema.parse(body)
}

export const deletePlatformInstance = async (id: string): Promise<void> => {
  const res = await fetch(`/api/platform-instances/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const body = await readBody(res)
  requireOk(res, body)
}

export const applyPlatformInstances = async (): Promise<ApplyInstancesResult> => {
  const res = await fetch('/api/platform-instances/apply', { method: 'POST' })
  const body = await readBody(res)
  requireOk(res, body)
  return ApplyInstancesResultSchema.parse(body)
}

export const fetchTaskInstances = async (): Promise<TaskInstanceView[]> => {
  const res = await fetch('/api/task-instances')
  const body = await readBody(res)
  requireOk(res, body)
  return z.array(TaskInstanceViewSchema).parse(body)
}

export const createTaskInstance = async (input: CreateTaskInstanceInput): Promise<TaskInstanceView> => {
  const res = await fetch('/api/task-instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return TaskInstanceViewSchema.parse(body)
}

export const deleteTaskInstance = async (id: string): Promise<void> => {
  const res = await fetch(`/api/task-instances/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const body = await readBody(res)
  requireOk(res, body)
}

export const fetchTaskProviderTypes = async (): Promise<TaskProviderTypeView[]> => {
  const res = await fetch('/api/task-provider-types')
  const body = await readBody(res)
  requireOk(res, body)
  return z.array(TaskProviderTypeViewSchema).parse(body)
}

export const fetchAdmins = async (): Promise<AdminInstanceView[]> => {
  const res = await fetch('/api/admins')
  const body = await readBody(res)
  requireOk(res, body)
  return z.array(AdminInstanceViewSchema).parse(body)
}

export const createAdmin = async (input: CreateAdminInput): Promise<AdminInstanceView> => {
  const res = await fetch('/api/admins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return AdminInstanceViewSchema.parse(body)
}

export const deleteAdmin = async (userId: string, platformInstanceId: string): Promise<void> => {
  const res = await fetch(`/api/admins/${encodeURIComponent(userId)}/${encodeURIComponent(platformInstanceId)}`, {
    method: 'DELETE',
  })
  const body = await readBody(res)
  requireOk(res, body)
}
