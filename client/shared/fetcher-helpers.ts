// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const ErrorBodySchema = z.object({ error: z.string(), field: z.string().optional() })

export const errorMessageFrom = (body: unknown, fallback: string): string => {
  const parsed = ErrorBodySchema.safeParse(body)
  return parsed.success ? parsed.data.error : fallback
}

/** The offending form field, when the server attributed the error to one. */
export const errorFieldFrom = (body: unknown): string | undefined => {
  const parsed = ErrorBodySchema.safeParse(body)
  return parsed.success ? parsed.data.field : undefined
}

export const readBody = async (res: Response): Promise<unknown> => {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export class FetchError extends Error {
  readonly status: number
  readonly field: string | undefined
  constructor(status: number, message: string, field?: string) {
    super(message)
    this.name = 'FetchError'
    this.status = status
    this.field = field
  }
}

export const requireOk = (res: Response, body: unknown): void => {
  if (res.ok) return
  throw new FetchError(
    res.status,
    errorMessageFrom(body, `request failed with status ${res.status}`),
    errorFieldFrom(body),
  )
}
