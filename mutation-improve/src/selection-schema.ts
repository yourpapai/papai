// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

const RunnerUpSchema = z.object({
  file: z.string().min(1),
  score: z.number().min(0).max(1),
  why: z.string(),
})

export const SelectionSchema = z.object({
  file: z.string().min(1),
  beforeScore: z.number().min(0).max(1),
  rationale: z.string(),
  runnerUps: z.array(RunnerUpSchema).max(5),
})

export type Selection = z.infer<typeof SelectionSchema>
