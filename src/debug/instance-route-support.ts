// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'
import { z } from 'zod'

import { configFingerprint, errorMessage } from '../chat/router-helpers.js'
import type { ChatRouter } from '../chat/router.js'
import type { InstanceConfig, PlatformInstance } from '../instances/types.js'
import { jsonResponse } from './json-response.js'

export type InstanceApiDeps = {
  readonly getRuntimeChatRouter: () => ChatRouter | null
  readonly listActivePlatformInstances: () => PlatformInstance[]
}

const INSTANCE_APPLY_CONCURRENCY = 4
const instanceApplyLock = pLimit(1)

type ApplyFailureAction = 'remove' | 'recreate' | 'start' | 'stop'

type ApplyFailure = Readonly<{
  id: string
  action: ApplyFailureAction
  error: string
}>

type ApplyResultPatch = Readonly<{
  started?: readonly string[]
  stopped?: readonly string[]
  removed?: readonly string[]
  recreated?: readonly string[]
  unchanged?: readonly string[]
  failed?: readonly ApplyFailure[]
}>

export type ApplyInstancesResult = Readonly<{
  applied: number
  started: readonly string[]
  stopped: readonly string[]
  removed: readonly string[]
  recreated: readonly string[]
  unchanged: readonly string[]
  failed: readonly ApplyFailure[]
}>

const INSTANCE_API_PREFIXES = [
  '/api/admins',
  '/api/platform-provider-types',
  '/api/platform-instances',
  '/api/task-instances',
  '/api/task-provider-types',
] as const

export const instanceConfigSchema: z.ZodType<InstanceConfig> = z.record(z.string(), z.string())

export const platformInstanceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['telegram', 'mattermost', 'discord', 'kontur-talk']),
  config: instanceConfigSchema,
})

export const taskInstanceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  config: instanceConfigSchema,
})

export const statusSchema = z.object({ status: z.enum(['pending', 'active', 'stopped']) })

export const instancePatchSchema = z
  .object({
    config: instanceConfigSchema.optional(),
    status: z.enum(['pending', 'active', 'stopped']).optional(),
  })
  .refine(
    (value) => {
      if (value.config !== undefined) return true
      return value.status !== undefined
    },
    {
      message: 'at least one of config or status is required',
    },
  )

export const adminSchema = z.object({
  userId: z.string().min(1),
  platformInstanceId: z.string().min(1).optional(),
})

export const textResponse = (body: string, status: number): Response => new Response(body, { status })

export const validationError = (error: z.ZodError): Response =>
  jsonResponse({ error: 'invalid_request', issues: error.issues }, { status: 400 })

export const instanceExistsError = (id: string): Response =>
  jsonResponse({ error: 'instance_exists', id }, { status: 409 })

const isSqliteConstraintError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const candidate = error as Error & { readonly code?: string }
  return candidate.code === 'SQLITE_CONSTRAINT' || error.message.includes('UNIQUE constraint failed')
}

export const insertOrConflict = (id: string, insert: () => void): Response | null => {
  try {
    insert()
    return null
  } catch (error) {
    if (isSqliteConstraintError(error)) return instanceExistsError(id)
    throw error
  }
}

const failedPatch = (id: string, action: ApplyFailureAction, error: unknown): ApplyResultPatch => ({
  failed: [{ id, action, error: errorMessage(error) }],
})

const notActiveAfterStartError = (id: string): Error => new Error(`chat instance did not become active: ${id}`)

const mergeApplyResult = (applied: number, patches: readonly ApplyResultPatch[]): ApplyInstancesResult => ({
  applied,
  started: patches.flatMap((patch) => patch.started ?? []),
  stopped: patches.flatMap((patch) => patch.stopped ?? []),
  removed: patches.flatMap((patch) => patch.removed ?? []),
  recreated: patches.flatMap((patch) => patch.recreated ?? []),
  unchanged: patches.flatMap((patch) => patch.unchanged ?? []),
  failed: patches.flatMap((patch) => patch.failed ?? []),
})

const removeRuntimeInstance = async (router: ChatRouter, id: string): Promise<ApplyResultPatch> => {
  try {
    await router.removeInstanceStrict(id)
    return { stopped: [id], removed: [id] }
  } catch (error) {
    return failedPatch(id, 'stop', error)
  }
}

const startedPatch = (router: ChatRouter, id: string, action: ApplyFailureAction): ApplyResultPatch => {
  const runtimeInstance = router.getInstance(id)
  if (runtimeInstance !== null && runtimeInstance.status === 'active') return { started: [id] }
  return failedPatch(id, action, notActiveAfterStartError(id))
}

const startMissingInstance = async (router: ChatRouter, instance: PlatformInstance): Promise<ApplyResultPatch> => {
  try {
    router.addInstance(instance.id, instance.type, instance.config)
    await router.startInstance(instance.id)
    return startedPatch(router, instance.id, 'start')
  } catch (error) {
    return failedPatch(instance.id, 'start', error)
  }
}

const recreateInstance = async (router: ChatRouter, instance: PlatformInstance): Promise<ApplyResultPatch> => {
  const removed = await removeRuntimeInstance(router, instance.id)
  if ((removed.failed ?? []).length > 0) return removed

  try {
    router.addInstance(instance.id, instance.type, instance.config)
    await router.startInstance(instance.id)
    const runtimeInstance = router.getInstance(instance.id)
    if (runtimeInstance !== null && runtimeInstance.status === 'active') {
      return {
        stopped: removed.stopped,
        removed: removed.removed,
        started: [instance.id],
        recreated: [instance.id],
      }
    }
    return {
      stopped: removed.stopped,
      removed: removed.removed,
      ...failedPatch(instance.id, 'recreate', notActiveAfterStartError(instance.id)),
    }
  } catch (error) {
    return { stopped: removed.stopped, removed: removed.removed, ...failedPatch(instance.id, 'recreate', error) }
  }
}

const startStoppedInstance = async (router: ChatRouter, instance: PlatformInstance): Promise<ApplyResultPatch> => {
  try {
    await router.startInstance(instance.id)
    return startedPatch(router, instance.id, 'start')
  } catch (error) {
    return failedPatch(instance.id, 'start', error)
  }
}

const reconcileActiveInstance = (router: ChatRouter, instance: PlatformInstance): Promise<ApplyResultPatch> => {
  const runtimeInstance = router.getInstance(instance.id)
  if (runtimeInstance === null) return startMissingInstance(router, instance)

  const desiredFingerprint = configFingerprint(instance.type, instance.config)
  if (runtimeInstance.type !== instance.type || runtimeInstance.configFingerprint !== desiredFingerprint) {
    return recreateInstance(router, instance)
  }
  if (runtimeInstance.status === 'stopped') return startStoppedInstance(router, instance)

  return Promise.resolve({ unchanged: [instance.id] })
}

const reconcilePlatformInstances = async (deps: InstanceApiDeps): Promise<Response> => {
  const router = deps.getRuntimeChatRouter()
  if (router === null) return jsonResponse({ error: 'router not initialised' }, { status: 503 })

  const activeInstances = deps.listActivePlatformInstances()
  const activeIds = new Set(activeInstances.map((instance) => instance.id))
  const runtimeIdsToRemove = router
    .listInstances()
    .map((instance) => instance.id)
    .filter((id) => !activeIds.has(id))
  const limit = pLimit(INSTANCE_APPLY_CONCURRENCY)
  const removePatches = runtimeIdsToRemove.map((id) => limit(removeRuntimeInstance, router, id))
  const activePatches = activeInstances.map((instance) => limit(reconcileActiveInstance, router, instance))
  const patches = await Promise.all([...removePatches, ...activePatches])

  return jsonResponse(mergeApplyResult(activeInstances.length, patches))
}

export const applyPlatformInstances = (deps: InstanceApiDeps): Promise<Response> =>
  instanceApplyLock(reconcilePlatformInstances, deps)

const parseJson = async (req: Request): Promise<unknown> => {
  try {
    return await req.json()
  } catch {
    return undefined
  }
}

export const parseBody = async <T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> => {
  const result = schema.safeParse(await parseJson(req))
  return result.success ? result.data : validationError(result.error)
}

export const splitPath = (url: URL): readonly string[] =>
  url.pathname
    .split('/')
    .filter((part) => part !== '')
    .map((part) => decodeURIComponent(part))

export const isInstanceApiPath = (pathname: string): boolean =>
  INSTANCE_API_PREFIXES.some((prefix) => [pathname === prefix, pathname.startsWith(`${prefix}/`)].includes(true))
