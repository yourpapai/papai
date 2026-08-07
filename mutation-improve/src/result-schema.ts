// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

// mutantIds names the Stryker mutant ids (from reports/paired/<stem>.stryker-report.json)
// this residual covers. The runner set-matches their union against its own
// measured surviving ids to open the capped gate; omitted means "covers nothing".
const ResidualSchema = z.object({
  loc: z.string(),
  why: z.string(),
  mutantIds: z.array(z.string().min(1)).default([]),
})

export const ResultSchema = z.object({
  specPath: z.string().min(1),
  planPath: z.string().min(1),
  testPaths: z.array(z.string().min(1)).min(1),
  residuals: z.array(ResidualSchema),
  notes: z.string().default(''),
})

export type Result = z.infer<typeof ResultSchema>
