// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const CodingModelsResponseSchema = z.object({
  ok: z.boolean(),
  models: z.array(z.object({ value: z.string(), label: z.string() })),
})
export type CodingModelsResponse = z.infer<typeof CodingModelsResponseSchema>
