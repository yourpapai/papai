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
  // Optional rather than removed. The runner no longer asks for a design.md or
  // a tasks.md per improved file — every section of them restated something it
  // already measures or set-matches — but `--resume-run` reads results stored
  // by an earlier run, which carry both paths. Removing the fields outright
  // would reject a run in flight the day this shipped; permitting `''` instead
  // would encode "absent" as a sentinel every later reader has to know.
  specPath: z.string().min(1).optional(),
  planPath: z.string().min(1).optional(),
  testPaths: z.array(z.string().min(1)).min(1),
  residuals: z.array(ResidualSchema),
  notes: z.string().default(''),
})

export type Result = z.infer<typeof ResultSchema>
