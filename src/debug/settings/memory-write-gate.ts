// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { MemoryScope } from '../../long-term-memory/types.js'
import type { AuthenticatedSettingsRequest } from '../../settings/request-auth.js'
import { toMemoryScope } from './memory-scope.js'
import {
  authenticate,
  parseJsonBody,
  requireCsrf,
  resolveContextScope,
  settingsJson,
  type ParsedBody,
} from './respond.js'

export type WriteGate =
  | { readonly ok: true; readonly authed: AuthenticatedSettingsRequest }
  | { readonly ok: false; readonly response: Response }

/** Authenticate + CSRF-check a write request; the shared prelude for every mutating memory route. */
export function authenticateForWrite(req: Request): WriteGate {
  const auth = authenticate(req)
  if (!auth.ok) return { ok: false, response: auth.response }
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return { ok: false, response: csrf }
  return { ok: true, authed: auth.authed }
}

export type ResolvedWrite<T> =
  | { readonly ok: true; readonly memoryScope: MemoryScope; readonly data: T }
  | { readonly ok: false; readonly response: Response }

/** Parse + validate a write body and resolve it to an authorized memory scope. */
export async function resolveWriteBody<T extends { contextId?: string }>(
  req: Request,
  authed: AuthenticatedSettingsRequest,
  schema: z.ZodType<T>,
  parseBody: (req: Request) => Promise<ParsedBody> = parseJsonBody,
): Promise<ResolvedWrite<T>> {
  const parsed = await parseBody(req)
  if (!parsed.ok) return { ok: false, response: parsed.response }
  const body = schema.safeParse(parsed.value)
  if (!body.success) return { ok: false, response: settingsJson(422, { error: 'invalid request' }) }

  const scope = resolveContextScope(authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return { ok: false, response: scope.response }

  return { ok: true, memoryScope: toMemoryScope(scope.scope), data: body.data }
}
