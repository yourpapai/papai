// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { SpecStage } from '../../src/context-vault/reducer.js'
import type { ContextVaultListFilter } from '../../src/plugins/context-vault-facade.js'
import type { PluginContext } from '../../src/plugins/context.js'
import type { PluginToolRuntimeContext } from '../../src/plugins/types.js'

const SPEC_STAGES = ['draft', 'approved', 'in-progress', 'done'] as const

const listInputJsonSchema = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'Only specs pushed for this repository name' },
    status: {
      type: 'string',
      enum: [...SPEC_STAGES],
      description: 'Only specs currently at this stage',
    },
    changedSince: {
      type: 'integer',
      minimum: 0,
      description: 'Only specs whose latest file mtime is at or after this epoch-ms timestamp',
    },
  },
  additionalProperties: false,
} as const

const getInputJsonSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: "Full 'repo:change-name' id, or a bare change name when unique across repos",
    },
  },
  required: ['id'],
  additionalProperties: false,
} as const

const ListInputSchema = z.strictObject({
  repo: z.string().min(1).optional(),
  status: z.enum(SPEC_STAGES).optional(),
  changedSince: z.number().int().nonnegative().optional(),
})

const GetInputSchema = z.strictObject({
  id: z.string().min(1),
})

const toFilter = (parsed: z.infer<typeof ListInputSchema>): ContextVaultListFilter => ({
  ...(parsed.repo === undefined ? {} : { repo: parsed.repo }),
  ...(parsed.status === undefined ? {} : { status: parsed.status as SpecStage }),
  ...(parsed.changedSince === undefined ? {} : { changedSince: parsed.changedSince }),
})

const executeList = (input: unknown, runtimeContext: PluginToolRuntimeContext): Promise<unknown> =>
  Promise.resolve().then(() => {
    const parsed = ListInputSchema.parse(input)
    return runtimeContext.contextVault.list(toFilter(parsed))
  })

const executeGet = (input: unknown, runtimeContext: PluginToolRuntimeContext): Promise<unknown> =>
  Promise.resolve().then(() => {
    const parsed = GetInputSchema.parse(input)
    return runtimeContext.contextVault.get(parsed.id)
  })

/**
 * Registers the two vault tools. This module is loaded via
 * `import.meta.require('./runtime.js')` from the entry point so its bare `zod`
 * import stays out of the discovery scanner's static entry graph (which forbids
 * bare-module imports). See `index.ts`.
 */
export function registerContextVault(ctx: PluginContext): void {
  ctx.log.info({}, 'context-vault plugin activated')

  ctx.registration.registerTool({
    name: 'list_agent_specs',
    capabilityId: 'context-vault.specs.list',
    description:
      'List coding-session spec changes pushed to the context vault, with stage, task progress, and freshness metadata',
    inputSchema: listInputJsonSchema,
    execute: executeList,
  })

  ctx.registration.registerTool({
    name: 'get_agent_spec',
    capabilityId: 'context-vault.specs.get',
    description:
      'Read one context-vault spec change: one-line summary, detailed summary, outline, stage, progress, and freshness metadata',
    inputSchema: getInputJsonSchema,
    execute: executeGet,
  })
}
