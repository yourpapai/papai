// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { BillingSubjectSchema, GlobalStatsSchema, SubjectStatsSchema } from '../../admin/fetcher-schemas.js'
import { makeBillingSubject, makeGlobalStats, makeSubjectStats } from './index.js'

const KnownFixtureSchema = z.union([BillingSubjectSchema, GlobalStatsSchema, SubjectStatsSchema])

export function assertFixturesMatchSchemas(extras: readonly unknown[] = []): void {
  const candidates: readonly unknown[] = [makeBillingSubject(), makeGlobalStats(), makeSubjectStats(), ...extras]
  for (const candidate of candidates) {
    const result = KnownFixtureSchema.safeParse(candidate)
    if (!result.success) {
      throw new Error(`fixture failed schema validation: ${result.error.message}`)
    }
  }
}
