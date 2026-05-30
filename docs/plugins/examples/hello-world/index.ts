// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { PluginContext } from '../../../../src/plugins/context.js'
import type { PluginFactory } from '../../../../src/plugins/types.js'

const greetingInputSchema = z.object({
  name: z.string(),
})

const factory: PluginFactory = () => ({
  activate(ctx: PluginContext): void {
    ctx.log.info({}, 'hello-world plugin activated')

    ctx.registration.registerTool({
      name: 'greet',
      description: 'Greet a person by name',
      inputSchema: greetingInputSchema,
      execute(args: unknown): Promise<unknown> {
        const input = greetingInputSchema.parse(args)
        return Promise.resolve({ greeting: `Hello, ${input.name}!` })
      },
    })

    ctx.registration.registerPromptFragment({
      name: 'hello-world-hint',
      content: 'When the user asks for a greeting, use the greet tool.',
    })

    ctx.registration.registerCommand({
      name: 'hello',
      description: 'Send a friendly hello from the plugin',
      execute(_message, reply): Promise<void> {
        return reply.text('Hello from the hello-world plugin.')
      },
    })

    ctx.registration.registerScheduledJob({
      name: 'daily_hello',
      intervalMs: 24 * 60 * 60 * 1000,
      execute({ contextId }): void {
        ctx.log.info({ contextId }, 'hello-world scheduled job tick')
      },
    })
  },

  deactivate(ctx: PluginContext): void {
    ctx.log.info({}, 'hello-world plugin deactivated')
  },
})

export default factory
