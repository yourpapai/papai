// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'
import { z } from 'zod'

import type { ChatRouter } from '../chat/router.js'
import type { InstanceConfig, PlatformInstance } from '../instances/types.js'
import { jsonResponse } from './json-response.js'

export type InstanceApiDeps = {
  readonly getRuntimeChatRouter: () => ChatRouter | null
  readonly listActivePlatformInstances: () => PlatformInstance[]
}

const INSTANCE_APPLY_CONCURRENCY = 4

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
  type: z.enum(['telegram', 'mattermost', 'discord']),
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

export const applyPlatformInstances = async (deps: InstanceApiDeps): Promise<Response> => {
  const router = deps.getRuntimeChatRouter()
  if (router === null) return jsonResponse({ error: 'router not initialised' }, { status: 503 })

  const activeInstances = deps.listActivePlatformInstances()
  const activeIds = new Set(activeInstances.map((instance) => instance.id))
  const runtimeIds = router.listInstances().map((instance) => instance.id)
  const removed = runtimeIds.filter((id) => !activeIds.has(id))
  const missing = activeInstances.filter((instance) => router.getInstance(instance.id) === null)
  const stopped = activeInstances.filter((instance) => {
    const runtimeInstance = router.getInstance(instance.id)
    return runtimeInstance !== null && runtimeInstance.status === 'stopped'
  })
  const limit = pLimit(INSTANCE_APPLY_CONCURRENCY)

  await Promise.all(removed.map((id) => limit(() => router.removeInstance(id))))
  await Promise.all(
    missing.map((instance) =>
      limit(async () => {
        router.addInstance(instance.id, instance.type, instance.config)
        await router.startInstance(instance.id)
      }),
    ),
  )
  await Promise.all(stopped.map((instance) => limit(() => router.startInstance(instance.id))))

  return jsonResponse({ applied: activeInstances.length })
}

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
