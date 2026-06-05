// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

const SIGNING_VERSION = 1
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u

export type MattermostActionContextInput = Readonly<{
  platformInstanceId: string
  callbackData: string
  sourceMessageText: string
  expiresAt: number
}>

export const MattermostSignedActionContextSchema = z.strictObject({
  version: z.literal(SIGNING_VERSION),
  platformInstanceId: z.string().min(1),
  callbackData: z.string().min(1),
  sourceMessageText: z.string(),
  expiresAt: z.number().int().positive(),
  nonce: z.string().min(16),
  signature: z.string().regex(SIGNATURE_PATTERN),
})

export type MattermostSignedActionContext = z.infer<typeof MattermostSignedActionContextSchema>

export type VerifiedMattermostActionContext = MattermostActionContextInput
export type MattermostActionVerificationResult =
  | { ok: true; value: VerifiedMattermostActionContext }
  | { ok: false; reason: 'invalid_shape' | 'expired' | 'bad_signature' }

const canonicalPayload = (context: Omit<MattermostSignedActionContext, 'signature'>): string =>
  JSON.stringify({
    version: context.version,
    platformInstanceId: context.platformInstanceId,
    callbackData: context.callbackData,
    sourceMessageText: context.sourceMessageText,
    expiresAt: context.expiresAt,
    nonce: context.nonce,
  })

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url')

const signaturesMatch = (actual: string, expected: string): boolean => {
  const actualBuffer = Buffer.from(actual, 'base64url')
  const expectedBuffer = Buffer.from(expected, 'base64url')
  if (actualBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(actualBuffer, expectedBuffer)
}

export function createMattermostActionContext(
  input: MattermostActionContextInput,
  secret: string,
): MattermostSignedActionContext {
  const unsigned = {
    version: SIGNING_VERSION,
    platformInstanceId: input.platformInstanceId,
    callbackData: input.callbackData,
    sourceMessageText: input.sourceMessageText,
    expiresAt: input.expiresAt,
    nonce: randomBytes(16).toString('base64url'),
  } satisfies Omit<MattermostSignedActionContext, 'signature'>
  return { ...unsigned, signature: sign(canonicalPayload(unsigned), secret) }
}

export function verifyMattermostActionContext(
  value: unknown,
  secret: string,
  now: number = Date.now(),
): MattermostActionVerificationResult {
  const parsed = MattermostSignedActionContextSchema.safeParse(value)
  if (!parsed.success) return { ok: false, reason: 'invalid_shape' }
  const { signature, ...unsigned } = parsed.data
  if (parsed.data.expiresAt <= now) return { ok: false, reason: 'expired' }
  const expected = sign(canonicalPayload(unsigned), secret)
  if (!signaturesMatch(signature, expected)) return { ok: false, reason: 'bad_signature' }
  return {
    ok: true,
    value: {
      platformInstanceId: parsed.data.platformInstanceId,
      callbackData: parsed.data.callbackData,
      sourceMessageText: parsed.data.sourceMessageText,
      expiresAt: parsed.data.expiresAt,
    },
  }
}
