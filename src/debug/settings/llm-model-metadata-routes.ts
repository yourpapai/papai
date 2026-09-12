// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getModelsDevSnapshot } from '../../models-dev/client.js'
import { resolveModelMetadata } from '../../models-dev/resolve.js'
import { authenticate, settingsJson } from './respond.js'

const LookupQuerySchema = z.object({
  providerType: z.string().optional(),
  baseUrl: z.string().optional(),
  baseProvider: z.string().optional(),
  baseModel: z.string().optional(),
  model: z.string().optional(),
})

const handleLookup = (url: URL): Response => {
  const parsed = LookupQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return settingsJson(422, { error: 'invalid request' })
  const query = parsed.data
  const metadata = resolveModelMetadata({
    providerType: query.providerType ?? null,
    baseUrl: query.baseUrl ?? null,
    baseProvider: query.baseProvider ?? null,
    baseModel: query.baseModel ?? null,
    model: query.model ?? '',
  })
  return settingsJson(200, { ...metadata, snapshotFetchedAt: getModelsDevSnapshot().fetchedAt })
}

export function handleLlmModelMetadataRoutes(req: Request, url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (req.method !== 'GET') return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  return Promise.resolve(handleLookup(url))
}
