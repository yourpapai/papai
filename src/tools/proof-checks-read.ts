// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { loadProofRecords, type ProofCheckRecord } from '../deferred-prompts/proof-store.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:read-proof-results' })

const defaultStore = { load: (): Promise<ProofCheckRecord[]> => loadProofRecords() }

/**
 * Admin-only disposable reader for recorded proof-check runs. The store is
 * process-global and deliberately unkeyed (the assembly gate guarantees a
 * single admin principal), so no chatUserId binding is needed here.
 */
export const makeReadProofResultsTool = (store: { load: () => Promise<ProofCheckRecord[]> } = defaultStore): Tool => {
  return tool({
    description:
      'List recent deferred-prompt proof-check runs with their verdicts, most recent first. Admin-only disposable diagnostics; records carry admin-own observations only.',
    inputSchema: z.object({
      run_id: z.string().optional().describe('Only return the run with this exact run id.'),
      limit: z.number().int().positive().optional().describe('Maximum number of runs to return, most recent first.'),
    }),
    execute: async (input) => {
      const records = await store.load()
      const filtered = input.run_id === undefined ? records : records.filter((record) => record.run_id === input.run_id)
      const ordered = [...filtered].reverse()
      const runs = input.limit === undefined ? ordered : ordered.slice(0, input.limit)
      log.info({ count: runs.length }, 'read_proof_results completed')
      return { runs }
    },
  })
}
