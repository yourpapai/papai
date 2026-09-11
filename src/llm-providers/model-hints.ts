// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const ModelHintsSchema = z.record(
  z.string(),
  z.object({
    baseProvider: z.string().trim().min(1),
    baseModel: z.string().trim().min(1),
  }),
)

export type ModelHints = Readonly<Record<string, { readonly baseProvider: string; readonly baseModel: string }>>

export const parseModelHints = (value: unknown): ModelHints => {
  const result = ModelHintsSchema.safeParse(value)
  return result.success ? result.data : {}
}
