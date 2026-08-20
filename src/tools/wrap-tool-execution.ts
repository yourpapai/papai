// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions, ToolSet } from 'ai'
import { z } from 'zod'

import { KNOWN_TOOL_SLUG_SET } from '../analytics/generated/tool-slugs.js'
import {
  isProviderRequestScope,
  runWithProviderRequestScope,
  type ProviderRequestScope,
} from '../analytics/provider-request-scope.js'
import { resolveAnalyticsToolSlug } from '../analytics/tool-slug-generation.js'
import type { Locale } from '../i18n/index.js'
import { logger } from '../logger.js'
import { buildToolFailureResult, createProviderScopeMissingFailureResult } from '../tool-failure.js'

const log = logger.child({ scope: 'tool-wrapper' })

/**
 * Strict tool `contextSchema` shared by every finalized executable descriptor.
 * `z.custom` validates without cloning, so the immutable scope object reaches
 * the execution wrapper by identity.
 */
export const providerRequestScopeContextSchema = z.custom<ProviderRequestScope>((value) =>
  isProviderRequestScope(value),
)

const logFailure = (
  toolName: string,
  toolCallId: string,
  failure: { error: string; errorType: string; errorCode: string },
): void => {
  log.error(
    {
      tool: resolveAnalyticsToolSlug(toolName, KNOWN_TOOL_SLUG_SET),
      toolCallId,
      errorType: failure.errorType,
      errorCode: failure.errorCode,
    },
    'Tool execution failed',
  )
}

/**
 * Outer execution wrapper for finalized tools. Validates
 * `ToolExecutionOptions.context` as exactly `ProviderRequestScope` and runs the
 * complete awaited execution inside `runWithProviderRequestScope`. An invalid,
 * absent, or malformed context maps to the controlled `provider_scope_missing`
 * failure before the underlying execute runs.
 */
export function wrapToolExecution(
  execute: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>,
  toolName: string,
  locale: Locale = 'en',
): (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown> {
  return async (input: unknown, options: ToolExecutionOptions<unknown>) => {
    const scope: unknown = options.context
    if (!isProviderRequestScope(scope)) {
      const failure = createProviderScopeMissingFailureResult(toolName, options.toolCallId, locale)
      logFailure(toolName, options.toolCallId, failure)
      return failure
    }
    try {
      return await runWithProviderRequestScope(scope, () => execute(input, options))
    } catch (error) {
      const failure = buildToolFailureResult(error, toolName, options.toolCallId, { locale })
      logFailure(toolName, options.toolCallId, failure)
      return failure
    }
  }
}

/**
 * Final per-invocation pass over the actual `ToolSet` (after guest/preference/
 * capability filters, result compaction, and disclosure). Attaches the shared
 * strict `ProviderRequestScope` `contextSchema` and the outer execution wrapper
 * to every executable descriptor. Assembled/cached descriptors stay scope-free
 * and unwrapped; no later step may create or replace an executable tool.
 */
export function finalizeProviderScopedTools(tools: ToolSet, locale: Locale = 'en'): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).flatMap(([name, tool]) => {
      if (tool === undefined || tool === null || tool.execute === undefined) return []
      return [
        [
          name,
          {
            ...tool,
            contextSchema: providerRequestScopeContextSchema,
            execute: wrapToolExecution(tool.execute.bind(tool), name, locale),
          },
        ],
      ]
    }),
  )
}

/**
 * Builds the AI SDK `toolsContext` record keyed by every name in the final full
 * `ToolSet`, each value referencing the same immutable scope. Never pass the
 * scope object as the whole record and never key only the currently
 * active/disclosed names.
 */
export function buildToolsContextRecord(
  tools: ToolSet,
  scope: ProviderRequestScope,
): Record<string, ProviderRequestScope> {
  return Object.fromEntries(Object.keys(tools).map((name) => [name, scope]))
}
