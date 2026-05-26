// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { InstanceConfig } from '../instances/types.js'
import { jsonResponse } from './json-response.js'

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
  .refine((value) => value.config !== undefined || value.status !== undefined, {
    message: 'at least one of config or status is required',
  })

export const adminSchema = z.object({
  userId: z.string().min(1),
  platformInstanceId: z.string().min(1).optional(),
})

export const textResponse = (body: string, status: number): Response => new Response(body, { status })

export const validationError = (error: z.ZodError): Response =>
  jsonResponse({ error: 'invalid_request', issues: error.issues }, { status: 400 })

export const instanceExistsError = (id: string): Response =>
  jsonResponse({ error: 'instance_exists', id }, { status: 409 })

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
