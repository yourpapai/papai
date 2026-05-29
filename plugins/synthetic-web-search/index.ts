// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { PluginContext } from '../../src/plugins/context.js'
import type { PluginFactory, PluginToolRuntimeContext } from '../../src/plugins/types.js'

const API_ENDPOINT = 'https://api.synthetic.new/v2/search'

const searchInputSchema = z.object({
  query: z.string().max(400),
  max_length: z.number().int().min(0).max(10000).optional().default(0),
  index: z.number().int().min(0).optional(),
})

const searchResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  text: z.string(),
  published: z.string().optional(),
})

const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
})

type SearchResult = z.infer<typeof searchResultSchema>
type SearchInput = z.infer<typeof searchInputSchema>

function truncate(text: string, maxLength: number): string {
  if (maxLength < 0) return text
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

function processSearchResults(results: SearchResult[], parsed: SearchInput): unknown {
  if (results.length === 0) {
    return { results: [] }
  }

  let selectedResults: SearchResult[] = results

  if (parsed.index !== undefined) {
    if (parsed.index >= results.length) {
      return {
        error: 'index_out_of_range',
        message: `Index ${parsed.index} is out of range (only ${results.length} result${results.length === 1 ? '' : 's'} available)`,
      }
    }
    selectedResults = [results[parsed.index]!]
  }

  let charsPerResult = Infinity
  if (parsed.max_length > 0 && selectedResults.length > 0) {
    charsPerResult = Math.floor(parsed.max_length / selectedResults.length)
  }

  return {
    results: selectedResults.map((result) => ({
      title: result.title,
      url: result.url,
      text: truncate(result.text, charsPerResult),
      published: result.published,
    })),
  }
}

async function executeSearch(
  input: unknown,
  runtimeContext: PluginToolRuntimeContext,
  abortSignal: AbortSignal | undefined,
  httpFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(runtimeContext.chatUserId || runtimeContext.storageContextId)
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const apiKey = runtimeContext.adminConfig.get('api_key')

  if (apiKey === undefined || httpFetch === undefined) {
    return { error: 'not_configured', message: 'Synthetic API key is not configured' }
  }

  const parsed = searchInputSchema.parse(input)

  try {
    const response = await httpFetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: parsed.query }),
      signal: abortSignal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { error: 'api_error', status: response.status, message: errorText }
    }

    const data: unknown = await response.json()
    const validated = searchResponseSchema.parse(data)

    return processSearchResults(validated.results, parsed)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { error: 'validation_error', message: err.message }
    }
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: 'timeout', message }
    }
    return { error: 'network_error', message }
  }
}

const factory: PluginFactory = () => {
  let httpFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined

  return {
    activate(ctx: PluginContext): void {
      httpFetch = ctx.providerRuntime?.httpFetch

      ctx.log.info({}, 'synthetic-web-search plugin activated')

      ctx.registration.registerTool({
        name: 'search',
        description: 'Uses a search engine which returns title, url, and content in markdown',
        inputSchema: searchInputSchema,
        execute: (input: unknown, runtimeContext: PluginToolRuntimeContext, options) =>
          executeSearch(input, runtimeContext, options.abortSignal, httpFetch),
      })

      ctx.registration.registerPromptFragment({
        name: 'web-search-hint',
        content:
          'When the user asks a question that requires up-to-date information not in your training data, use the search tool to find relevant web content. Use web_fetch to read full page content when a search result looks promising.',
      })
    },

    deactivate(ctx: PluginContext): void {
      ctx.log.info({}, 'synthetic-web-search plugin deactivated')
    },
  }
}

export default factory
