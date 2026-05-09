import type { ToolSet } from 'ai'

import type { TaskProvider } from '../providers/types.js'
import { makeToolProxy } from './tool-proxy.js'
import { buildTools } from './tools-builder.js'
import type { MakeToolsOptions, ToolMode } from './types.js'
import { wrapToolExecution } from './wrap-tool-execution.js'

export type { MakeToolsOptions, ToolMode }

function wrapToolSet(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).flatMap(([name, tool]) => {
      if (tool === undefined || tool === null || tool.execute === undefined) return []
      return [[name, { ...tool, execute: wrapToolExecution(tool.execute.bind(tool), name) }]]
    }),
  )
}

/**
 * Build a tool set for the given provider and context.
 *
 * Usage:
 * ```ts
 * makeTools(provider, { storageContextId: 'user-1:group-1', chatUserId: 'user-1', mode: 'normal' })
 * ```
 */
export function makeTools(provider: TaskProvider): ToolSet
export function makeTools(provider: TaskProvider, options: MakeToolsOptions): ToolSet
export function makeTools(provider: TaskProvider, ...args: readonly [MakeToolsOptions] | readonly []): ToolSet {
  const options = args[0]
  const storageContextId = options === undefined ? undefined : options.storageContextId
  const chatUserId = options === undefined ? undefined : options.chatUserId
  const username = options === undefined ? undefined : options.username
  const contextId = storageContextId
  const mode = options === undefined || options.mode === undefined ? 'normal' : options.mode
  const contextType = options === undefined ? undefined : options.contextType

  const internalTools = buildTools(provider, chatUserId, contextId, mode, contextType, username)
  const wrappedInternalTools = wrapToolSet(internalTools)
  return { papai_tool: makeToolProxy(wrappedInternalTools) }
}
