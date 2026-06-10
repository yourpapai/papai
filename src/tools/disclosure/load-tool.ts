// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { emitUser } from '../../debug/event-bus.js'
import { logger } from '../../logger.js'
import type { DisclosureSession } from './registry.js'

const log = logger.child({ scope: 'tool:load_tool' })

export function makeLoadToolTool(session: DisclosureSession, contextId: string): ToolSet[string] {
  return tool({
    description:
      'Activate one or more tools by name so you can call them. Pass every tool you expect to need in one call to avoid extra round-trips.',
    inputSchema: z.object({
      names: z.array(z.string().min(1)).min(1).describe('Tool names from search_tools results to activate'),
    }),
    execute: ({ names }) => {
      const { loaded, unknown } = session.markLoaded(names)
      const nowActive = session.activeToolNames().length
      emitUser('disclosure:load', contextId, { loadedCount: loaded.length, unknownCount: unknown.length, nowActive })
      log.debug({ contextId, loadedCount: loaded.length, unknownCount: unknown.length, nowActive }, 'load_tool served')
      return { loaded, unknown, nowActive }
    },
  })
}
