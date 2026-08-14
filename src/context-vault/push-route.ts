// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../logger.js'
import { applyPush, type ApplyPushDeps } from './spec-store.js'
import { verifyToken } from './token-store.js'

const log = logger.child({ scope: 'context-vault:push-route' })

const MAX_BODY_BYTES = 1024 * 1024

const FileSchema = z
  .object({
    path: z.string().min(1),
    kind: z.string().min(1),
    hash: z.string().min(1),
    mtime: z.number().int().nonnegative(),
    text: z.string().optional(),
  })
  .strict()

const PushBodySchema = z
  .object({
    repo: z.string().min(1),
    changeName: z.string().min(1),
    files: z.array(FileSchema).max(1000),
    deletions: z.array(z.string().min(1)).max(1000),
  })
  .strict()

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const unauthorized = (): Response => json(401, { error: 'unauthorized' })

const extractBearer = (req: Request): string | null => {
  const header = req.headers.get('Authorization')
  if (header === null) return null
  const match = /^Bearer (?<token>.+)$/u.exec(header)
  return match?.groups?.['token'] ?? null
}

/**
 * Reads the request body with a hard byte cap so an oversized payload is
 * aborted while streaming instead of being fully buffered first. Returns null
 * when the body exceeds the cap (or declares a Content-Length above it).
 */
const readBodyCapped = async (req: Request): Promise<string | null> => {
  const contentLength = req.headers.get('Content-Length')
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  }
  if (req.body === null) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  let exceeded = false
  for await (const chunk of req.body) {
    total += chunk.byteLength
    if (total > MAX_BODY_BYTES) {
      exceeded = true
      break
    }
    chunks.push(chunk)
  }
  if (exceeded) return null
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/**
 * Handles `POST /api/context-vault/push`. Mounted in the public capability lane
 * of the debug server, before the auth gate: the vault bearer token is the only
 * credential. Unknown, revoked, and malformed tokens all get a uniform 401.
 */
export async function handleContextVaultPush(req: Request, deps: Partial<ApplyPushDeps> = {}): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const bearer = extractBearer(req)
  if (bearer === null) {
    log.warn('Context vault push rejected: missing or malformed bearer')
    return unauthorized()
  }
  const verified = verifyToken(bearer)
  if (verified === null) return unauthorized()

  const raw = await readBodyCapped(req)
  if (raw === null) {
    log.warn({ configContextId: verified.configContextId }, 'Context vault push rejected: body too large')
    return json(413, { error: 'body too large' })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return json(400, { error: 'invalid JSON body' })
  }
  const body = PushBodySchema.safeParse(parsed)
  if (!body.success) return json(422, { error: 'invalid request' })

  let result
  try {
    result = applyPush(verified.configContextId, body.data, deps)
  } catch (error) {
    log.error(
      { configContextId: verified.configContextId, error: error instanceof Error ? error.message : String(error) },
      'Context vault push failed',
    )
    return json(500, { error: 'internal error' })
  }
  log.info({ configContextId: verified.configContextId, specId: result.specId }, 'Context vault push accepted')
  return json(200, { ok: true, ...result })
}
